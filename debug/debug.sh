#!/bin/bash
set -e
export NAMESPACE=${1:-demonstrations}
export OWNER=${2:-"anders.aslund@teknoir.ai"}
export KFAM_URL=${3:-"http://localhost:8081"}
export LS_HOST=${3:-"localhost:8080"}
export DOMAIN=${4:-"teknoir.info"}
export PIPELINES_HOST="http://localhost:8889"
export PROJECT_ID="teknoir-poc"
export ADD_AUTH_HEADER="true"
npm start
