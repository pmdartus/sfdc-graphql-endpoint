# Print command before running
set -o xtrace

ORG_ALIAS=sfdc-graphql-integration-test

# Create a new scratch org
sfdx force:org:create -s -f config/project-scratch-def.json -a $ORG_ALIAS

# Push metadata
sfdx force:source:push

# Populate with some test records
sfdx force:data:tree:import -p ./data/sample-plan.json
sfdx force:data:tree:import -p ./data/ebike-plan.json