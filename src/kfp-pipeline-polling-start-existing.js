const fs = require("fs");
const fetch = require("node-fetch");
const yaml = require("js-yaml");
const util = require("./utils");
const pipeUtils = require("./pipeline-utils");

module.exports = async function (RED) {
  const TEMPLATES_DIR = `${__dirname}/templates`;
  const teknoir_config = await util.config();
  const authHeader = teknoir_config.ADD_AUTH_HEADER
    ? {
        "x-goog-authenticated-user-email": `securetoken.google.com/${teknoir_config.PROJECT_ID}:${teknoir_config.OWNER}`,
      }
    : {};
  const kfp = util.kfp(teknoir_config.PIPELINES_HOST, authHeader);

  function StartPipeline(config) {
    var node = this;
    RED.nodes.createNode(this, config);
    const context = this.context();

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
      if (!config.selectedPipeline) {
        node.error("Please select pipeline template");
        return;
      }
      // console.log(config.selectedPipeline);
      const pipeline = await kfp.getPipeline(config.selectedPipeline);
      const pipelineVersion = pipeline.default_version.id
      const pipelineTemplate = await kfp.getVersionTemplate(pipelineVersion)
      const disableCaching = config.disableCache || false
      // all code for disabling cache is taken as example from
      // https://github.com/kubeflow/pipelines/blob/74c7773ca40decfd0d4ed40dc93a6af591bbc190/sdk/python/tests/compiler/testdata/uri_artifacts.yaml
      // and from https://github.com/kubeflow/pipelines/blob/master/sdk/python/kfp/client/client.py#L991
      let pipelineYaml;
      if(disableCaching){
        const pipelineJson = JSON.parse(pipelineTemplate.template)
        pipelineJson.metadata.labels['pipelines.kubeflow.org/cache_enabled'] = 'false'
        pipelineJson.metadata.labels['pipelines.kubeflow.org/v2_pipeline'] = "true"
        pipelineJson.metadata.annotations['pipelines.kubeflow.org/v2_pipeline'] = "true"
        const steps = pipelineJson.spec.templates.map(t => {
          if(t.dag?.tasks){
            const tasks = t.dag.tasks.map(task => {
              task.cachingOptions = task.cachingOptions || {}
              task.cachingOptions.enableCache = false
              return task
            })
            t.dag.tasks = tasks
          }
          t.metadata.annotations = t.metadata.annotations || {}
          t.metadata.labels = t.metadata.labels || {}
          t.metadata.labels['pipelines.kubeflow.org/enable_caching'] = "false"
          t.metadata.annotations['pipelines.kubeflow.org/v2_component'] = "true"
          return t
        })
        pipelineJson.spec.templates = steps
        pipelineYaml = yaml.dump(pipelineJson)
      }
      
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
          pipeline.default_version.parameters.find(
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
      const pipelineRun = pipeUtils.pipelineRunFromVersion(
        runName,
        pipeline.default_version.id,
        experiment_id,
        pipelineParams,
        pipelineYaml
      );

      const runResult = await kfp.createRun(pipelineRun);
      const nodeStatus = pipeUtils.nodeStatusFromPipelineStatus(
        runResult.status
      );
      node.status(nodeStatus);
      poll(runResult.run.id);
    });
  }

  RED.nodes.registerType("run-existing-and-poll", StartPipeline);

  RED.httpAdmin.get("/kfp/pipelines", async function (req, res) {
    const pipelines = await kfp.getPipelines();
    res.json(pipelines);
  });
};
