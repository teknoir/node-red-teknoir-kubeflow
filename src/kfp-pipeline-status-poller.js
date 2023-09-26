const util = require("./utils");
const pipeUtils = require("./pipeline-utils");

module.exports = async function (RED) {
  const teknoir = await util.config();

  function Init(config) {
    var node = this;
    RED.nodes.createNode(this, config);
    const context = this.context();

    const authHeader = teknoir.ADD_AUTH_HEADER
      ? {
          "x-goog-authenticated-user-email": `securetoken.google.com/${teknoir.PROJECT_ID}:${teknoir.OWNER}`,
        }
      : {};

    const kfp = util.kfp(teknoir.PIPELINES_HOST, authHeader);

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
            run: run,
            // shortcuts for input selectors
            status: run.status,
            run_id: runId,
            input_args: inputs,
          };

          node.send({ payload });
        }
      }
    }

    node.on("input", async function (msg) {
      if (msg.payload.run) {
        poll(msg.payload.run.id);
      }
    });
  }

  RED.nodes.registerType("pipeline-status-poller", Init);
};
