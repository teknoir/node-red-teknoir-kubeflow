const fs = require("fs");
const fetch = require("node-fetch");
const yaml = require("js-yaml");
const util = require("./utils");
const pipeUtils = require("./pipeline-utils");

module.exports = async function (RED) {
  const TEMPLATES_DIR = `${__dirname}/templates`;
  const teknoir_config = await util.config();

  function StartPipeline(config) {
    var node = this;
    RED.nodes.createNode(this, config);
    const context = this.context();

    const authHeader = teknoir_config.ADD_AUTH_HEADER
      ? {
          "x-goog-authenticated-user-email": `securetoken.google.com/${teknoir_config.PROJECT_ID}:${teknoir_config.OWNER}`,
        }
      : {};

    const kfp = util.kfp(teknoir_config.PIPELINES_HOST, authHeader);

    function refreshRunStatus(runId) {
      return kfp.runDetails(runId).then((details) => {
        context.set("last_run_info", details.run);
        const nodeStatus = pipeUtils.nodeStatusFromPipelineStatus(
          details.run.status
        );
        node.status(nodeStatus);
        return details.run;
      });
    }

    let timerId;
    async function poll(runId) {
      const delay = 5000;
      const run = await refreshRunStatus(runId);
      context.set("last_run_info", run);
      if (!run.status || run.status == "Running") {
        clearInterval(timerId);
        timerId = setTimeout(() => poll(runId), delay);
      } else {
        clearInterval(timerId);

        if (
          run.status.toLowerCase() == config.triggerStatus.toLowerCase() ||
          config.triggerStatus == "" ||
          config.triggerStatus.toLowerCase() == "any"
        ) {
          console.log("Matched trigger status", run.status);
          //converting params array to object
          const pipeIn = run.pipeline_spec.parameters || [];
          const inputs = pipeUtils.argumentsToObj(pipeIn);

          const payload = {
            run,
            // shortcuts for input selectors
            run_id: runId,
            status: run.status,
            input_args: inputs,
          };

          node.send({ payload });
        }
      }
    }

    node.on("input", async function (msg) {
      if (!config.selectedTemplate) {
        node.error("Please select pipeline template");
        return;
      }
      let template = util.readTemplate(TEMPLATES_DIR, config.selectedTemplate);

      const userParams = pipeUtils.argumentsToObj(config.userArguments);
      const parsedParams = msg.payload[`${config.agrumentsSelector}`];

      let msgParams;
      if (typeof parsedParams === "object" && parsedParams !== null) {
        msgParams = parsedParams;
      } else {
        msgParams = {};
      }
      const pipelineParams = pipeUtils
        .objToArguments({
          ...userParams,
          ...msgParams, // msg param will take priority over user defined
        })
        .filter((param) =>
          // leaving only those who are in pipeline config
          template.spec.arguments.parameters.find(
            (pipelineArg) => pipelineArg.name === param.name
          )
        );

      const experimentName = "Default";
      const experiment = await kfp.findExperiment(
        experimentName,
        teknoir_config.NAMESPACE
      );

      let experiment_id = null;
      if (!experiment) {
        const result = await kfp.createExperiment(
          experimentName,
          teknoir_config.NAMESPACE
        );
        experiment_id = result.id;
      } else {
        experiment_id = experiment.id;
      }

      const runName = config.runName || "devstudio-run-pipeline";
      const pipeline = pipeUtils.pipelineRunFrom(
        template,
        runName,
        pipelineParams,
        experiment_id
      );

      const runResult = await kfp.createRun(pipeline);
      const nodeStatus = pipeUtils.nodeStatusFromPipelineStatus(
        runResult.status
      );
      node.status(nodeStatus);
      poll(runResult.run.id);
    });
  }

  RED.nodes.registerType("run-and-poll", StartPipeline);

  RED.httpAdmin.get("/kfp/templates", function (req, res) {
    const files = util.readTemplates(TEMPLATES_DIR);
    res.json(files);
  });
};
