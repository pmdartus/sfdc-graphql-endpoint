# Generated GraphQL API for Salesforce

This project is a proof-of-concept exploring how to automatically generate a GraphQL API for Salesforce. You can think about this as [Hasura](https://hasura.io/) or [PostGraphile](https://www.graphile.org/) for Salesforce.

## Examples

```gql
# Retrieve a specific product by id
query getProductById($id: ID!) {
    Product__c_by_id(id: $id) {
        Id
        Name
    }
}
```

```gql
# Sorting: Retrieve most expensive products
{
    Product__c(order_by: { Price__c: DESC }, limit: 5) {
        Name
        Price__c
    }
}
```

```gql
# Range filter: Retrieve products in a specific price range
{
    Product__c(where: { price__c: { _gt: 1300, _lt: 1500 } }, order_by: { Name: ASC }, limit: 10) {
        Name
        Price__c
    }
}
```

```gql
# LIKE operator: Retrieve products with matching name
{
    Product__c(where: { Name: { _like: "Neomov%" } }, order_by: { Name: ASC }, limit: 10) {
        Name
        Price__c
    }
}
```

```gql
# Lookup filter: Retrieve products with the specific family name
{
    Product__c(
        where: { Product_Family__rc: { Name: { _eq: "Rolling Mountain" } } }
        order_by: { name: ASC }
        limit: 10
    ) {
        Name
        Price__c
        Product_Family__c {
            Name
        }
    }
}
```

```gql
# Find all the orders and products associated with those orders
{
    Order__c(limit: 10) {
        Order_Items__r(limit: 10, order_by: { Name: DESC }) {
            Product__c {
                Name
                Price__c
            }
        }
    }
}
```

## Design details

When invoked for the first time the GraphQL endpoint retrieves the org entities metadata using the [describeSObject](https://developer.salesforce.com/docs/atlas.en-us.234.0.api.meta/api/sforce_api_calls_describesobjects_describesobjectresult.htm) rest API. A GraphQL schema is created based on the entities' shapes. Each SObject is represented by a GraphQL object type in the schema. The schema exposes 2 entry points per entity: `<Entity_name>` to retrieve a list of records and `<Entity_name>_by_id` to retrieve a single record. This generated GraphQL schema can be queried by a [GraphQL introspection query](https://graphql.org/learn/introspection/).

For performance reasons, GraphQL queries are turned into a single SOQL query. The server uses Salesforce [Query REST API](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm) to execute the SOQL query. The query API response is then mapped back to the GraphQL schema before returning the GraphQL response.

### Available features

-   Schema generation from SObject metadata
-   Lookups, Master-Detail and Children relationships traversal
-   Query single record by id
-   Query multiple records
    -   Simple field and relationship filtering (`where` argument)
    -   Complex filtering (`_and` and `_or` logical operators)
    -   Limit and offset results (`limit` and `offset` arguments)
    -   Sorting (`order_by` argument)

### Missing features

-   Authentication
-   Multi-org / multi-tenant
-   Polymorphic relationships
-   Mutation requests
-   [Relay compliant](https://relay.dev/docs/guides/graphql-server-specification/) GraphQL schema

## Setup

**Setting up the project:**

```sh
npm install
npm run build
```

**Running the dev server:**

The dev server requires `ACCESS_TOKEN` and `INSTANCE_URL` environment variables to be set prior to running the command. When targeting a scratch org instance, you can run: `sfdx force:user:display`

```sh
ACCESS_TOKEN=[salesforce_access_token] INSTANCE_URL=[org_instance_url] npm run start
```

**Running integration tests:**

The integration test runs against a live scratch org with mock data. This org has to be created first prior running the tests. The scratch org definition is located in `integration/sfdx-org` and requires the SFDX CLI to be installed locally to create it.

```sh
./integration/sfdx-org/setup.sh

npm run test:integration                # Run the test suite once
npm run test:integration -- --watch     # Run the test suite in watch mode
```
