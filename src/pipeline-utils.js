/**
 * flattens [{"name": "value"}] formed array to object {name: value}
 * @param {*} args
 * @returns
 */
function argumentsToObj(args) {
  return args.reduce((acc, next) => {
    acc[next["name"]] = next["value"];
    return acc;
  }, {});
}

/**
 * transform object to {"name": "value"} array
 * @param {*} obj
 * @returns [{"name": "value"}] (pipeline compatible inputs)
 */
function objToArguments(obj) {
  return Object.entries(obj).map((entry) => {
    const entryVal = entry[1];
    const value = Array.isArray(entryVal)
      ? JSON.stringify(entryVal) // we need to stringify value if it is array (╯°□°)╯︵ ┻━┻
      : entryVal;
    return { name: entry[0], value };
  });
}

function pipelineRunFromVersion(
  runName,
  pipeLineVersion,
  experimentId,
  pipelineParams,
  manifest
) {
  let references = [
    {
      key: {
        id: experimentId,
        type: "EXPERIMENT",
      },
      relationship: "OWNER",
    }
  ]

  const pipelineRef = {
    key: {
      id: pipeLineVersion,
      type: "PIPELINE_VERSION",
    },
    relationship: "CREATOR",
  }

  // you cant submit manifest with ref to pipeline version
  // api errors
  if (!manifest){
    references.push(pipelineRef)
  }

  return {
    name: runName,
    pipeline_spec: {
      parameters: pipelineParams,
      pipeline_manifest: manifest
    },
    resource_references: references
  };
}

function pipelineRunFrom(template, runName, pipelineParams, experimentId) {
  return {
    name: runName,
    pipeline_spec: {
      workflow_manifest: JSON.stringify(template),
      parameters: pipelineParams,
    },
    resource_references: [
      {
        key: {
          id: experimentId,
          type: "EXPERIMENT",
        },
        relationship: "OWNER",
      },
    ],
  };
}

function nodeStatusFromPipelineStatus(status) {
  const running = "Running";
  const failed = "Failed";
  if (status == running) {
    return {
      fill: "yellow",
      shape: "dot",
      text: status,
    };
  } else if (status == undefined) {
    return {
      fill: "yellow",
      shape: "dot",
      text: "Scheduled",
    };
  } else if (status == failed) {
    return {
      fill: "red",
      shape: "dot",
      text: "Failed",
    };
  } else {
    return {
      fill: "green",
      shape: "dot",
      text: status,
    };
  }
}

module.exports = {
  argumentsToObj,
  objToArguments,
  pipelineRunFrom,
  pipelineRunFromVersion,
  nodeStatusFromPipelineStatus,
};
