const fs = require("fs");
const fetch = require("node-fetch");
const yaml = require("js-yaml");

function getOwner(namespace, kfamHost) {
  const url = `${kfamHost}/kfam/v1/bindings?namespace=${namespace}`;
  return fetch(url)
    .then((x) => x.json())
    .then((x) => x.bindings.find((x) => x.RoleRef.name == "admin").name);
}

function readTemplates(dir) {
  return fs.readdirSync(dir).map((file) => {
    const content = yaml.load(fs.readFileSync(`${dir}/${file}`));
    return { name: file, content };
  });
}

function readTemplate(dir, template) {
  return yaml.load(fs.readFileSync(`${dir}/${template}`));
}

function k8sNamespace() {
  try {
    return fs.readFileSync(
      "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
    );
  } catch (e) {
    return undefined;
  }
}

async function config() {
  NAMESPACE = process.env.NAMESPACE || k8sNamespace();
  KFAM_HOST =
    process.env.KFAM_URL ||
    "http://profiles-kfam.teknoir.svc.cluster.local:8081";
  return {
    ADD_AUTH_HEADER: process.env.ADD_AUTH_HEADER,
    PIPELINES_HOST:
      process.env.PIPELINES_HOST ||
      "http://ml-pipeline.teknoir.svc.cluster.local:8888",
    KFAM_HOST: KFAM_HOST,
    NAMESPACE: NAMESPACE,
    OWNER: process.env.OWNER || (await getOwner(NAMESPACE, KFAM_HOST)),
    PROJECT_ID: process.env.PROJECT_ID,
  };
}

function kfp(pipelines_api_host, authHeader) {
  const _apiUrl = `${pipelines_api_host}/apis/v1beta1`;
  function checkStatus(response, hint) {
    if (response.status >= 200 && response.status < 300) {
      return response;
    }
    else {
      console.log(respose)
      throw new Error(`Invalid response from ${hint}`)
    }
  }

  return {
    createRun: function (pipeline) {
      return fetch(`${_apiUrl}/runs`, {
        method: "POST",
        body: JSON.stringify(pipeline),
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
      })
        .then((res) => res.json())
        .then((json) => {
          return json;
        });
    },
    getPipelines: function () {
      return fetch(`${_apiUrl}/pipelines?sort_by=created_at%20desc`, {
        method: "GET",
        headers: authHeader,
      })
        .then((res) => {
          return res.json();
        })
        .then((json) => json.pipelines);
    },
    getPipeline: function (id) {
      return fetch(`${_apiUrl}/pipelines/${id}`, {
        method: "GET",
        headers: authHeader,
      }).then((res) => {
        return res.json();
      });
    },
    runDetails: function (runId) {
      return fetch(`${_apiUrl}/runs/${runId}`, {
        method: "GET",
        headers: authHeader,
      })
        .then((res) => {
          return res.json();
        })
        .then((json) => {
          return json;
        });
    },
    getVersionTemplate: function(versionId){
      const path = `/pipeline_versions/${versionId}/templates`
      return fetch(`${_apiUrl}${path}`, {
        method: "GET",
        headers: authHeader,
      })
        .then((res) => res.json())
        .then((json) => {
          return json;
        });
    },
    findExperiment: function (experimentName, namespace) {
      const path = `/experiments?resource_reference_key.type=NAMESPACE&resource_reference_key.id=${namespace}&filter={"predicates":[{"op":1,"key":"name","stringValue":"${experimentName}"}]}`;
      return fetch(`${_apiUrl}${path}`, {
        method: "GET",
        headers: authHeader,
      })
        .then((res) => res.json())
        .then((json) => {
          return json.experiments && json.experiments[0];
        });
    },
    createExperiment: function (experimentName, namespace) {
      return fetch(`${_apiUrl}/experiments`, {
        method: "POST",
        body: JSON.stringify({
          name: experimentName,
          resource_references: [
            {
              key: {
                id: namespace,
                type: "NAMESPACE",
              },
              relationship: "OWNER",
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
      })
        .then((res) => res.json())
        .then((json) => {
          return json;
        });
    },
  };
}

module.exports = {
  kfp,
  config,
  readTemplates,
  readTemplate,
};
