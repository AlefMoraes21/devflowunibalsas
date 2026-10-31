#!/usr/bin/env bash
set -euo pipefail
flow_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
flow_project="talks-servidor"
flow_region="southamerica-east1"
flow_service="devflowunibalsas-git"
flow_database="unibalsas-flow"
flow_queue="unibalsas-flow"

gcloud services enable cloudtasks.googleapis.com firestore.googleapis.com --project="$flow_project"

if ! gcloud firestore databases describe --project="$flow_project" --database="$flow_database" >/dev/null 2>&1; then
  gcloud firestore databases create --project="$flow_project" --database="$flow_database" --location="$flow_region" --type=firestore-native --delete-protection
fi
if ! gcloud tasks queues describe "$flow_queue" --project="$flow_project" --location="$flow_region" >/dev/null 2>&1; then
  gcloud tasks queues create "$flow_queue" --project="$flow_project" --location="$flow_region" --max-concurrent-dispatches=2 --max-dispatches-per-second=2 --max-attempts=5 --min-backoff=5s
fi

flow_runtime_sa="$(gcloud run services describe "$flow_service" --project="$flow_project" --region="$flow_region" --format='value(spec.template.spec.serviceAccountName)')"
if [[ -z "$flow_runtime_sa" ]]; then
  flow_project_number="$(gcloud projects describe "$flow_project" --format='value(projectNumber)')"
  flow_runtime_sa="${flow_project_number}-compute@developer.gserviceaccount.com"
fi
flow_origin="$(gcloud run services describe "$flow_service" --project="$flow_project" --region="$flow_region" --format='value(status.url)')"
if [[ ! "$flow_origin" =~ ^https://[^/]+\.run\.app/?$ ]]; then
  echo 'URL do serviço não reconhecida. Implantação interrompida.' >&2
  exit 1
fi

# Grants only the two runtime roles needed by this feature, to the existing service identity.
gcloud projects add-iam-policy-binding "$flow_project" --member="serviceAccount:$flow_runtime_sa" --role=roles/cloudtasks.enqueuer --condition=None --quiet --format=none
gcloud projects add-iam-policy-binding "$flow_project" --member="serviceAccount:$flow_runtime_sa" --role=roles/datastore.user --condition=None --quiet --format=none

# Automatic removal of encrypted jobs (2h) and proof-delivery locks (7d).
gcloud firestore fields ttls update expireAt --project="$flow_project" --database="$flow_database" --collection-group=flowJobs --enable-ttl --async
gcloud firestore fields ttls update expireAt --project="$flow_project" --database="$flow_database" --collection-group=flowDeliveryLocks --enable-ttl --async

gcloud run deploy "$flow_service" --project="$flow_project" --region="$flow_region" --source="$flow_source_dir" --timeout=180 --concurrency=20 --min-instances=1 --cpu-boost --update-env-vars="FLOW_PROJECT_ID=$flow_project,FLOW_DATABASE_ID=$flow_database,FLOW_TASKS_REGION=$flow_region,FLOW_TASKS_QUEUE=$flow_queue,FLOW_WORKER_ORIGIN=$flow_origin"

echo 'Servidor implantado. Atualize também o flow-waba.json na Meta antes de testar.'
curl --fail --silent --show-error "$flow_origin/api/flow"
echo
