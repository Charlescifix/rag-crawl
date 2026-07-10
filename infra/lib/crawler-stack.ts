import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";

interface CrawlerStackProps extends cdk.StackProps {
  stage: string;
}

const LAMBDA_DIR = path.resolve(__dirname, "../../services/api/src/lambdas");

const COMMON_BUNDLE = {
  runtime: lambda.Runtime.NODEJS_20_X,
  architecture: lambda.Architecture.ARM_64,
  // logRetention omitted — using explicit LogGroup constructs instead to avoid
  // the circular dependency caused by CDK's singleton log-retention custom resource.
  bundling: {
    minify: true,
    sourceMap: false,
    externalModules: ["@aws-sdk/*"],
    nodeModules: [
      "@mozilla/readability",
      "jsdom",
      "cheerio",
      "turndown",
      "robots-parser",
      "@anthropic-ai/sdk",
    ],
  },
};

export class CrawlerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CrawlerStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ── S3 Bucket ────────────────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, "DataBucket", {
      bucketName: `crawler-data-${stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "expire-raw-html",
          prefix: "sites/",
          expiration: cdk.Duration.days(14),
          // Only match raw HTML objects
          tagFilters: { type: "raw-html" },
        },
        {
          id: "expire-exports",
          prefix: "sites/",
          expiration: cdk.Duration.days(7),
          tagFilters: { type: "export" },
        },
        {
          id: "expire-job-state",
          prefix: "sites/",
          expiration: cdk.Duration.days(7),
          tagFilters: { type: "job-state" },
        },
      ],
    });

    // ── DynamoDB Table ───────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, "CrawlerTable", {
      tableName: `CrawlerTable-${stage}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: false,
    });

    // GSI for listing all sites by entity type (optional but useful)
    table.addGlobalSecondaryIndex({
      indexName: "EntityTypeIndex",
      partitionKey: { name: "entityType", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Shared env vars ──────────────────────────────────────────────────────
    const commonEnv = {
      CRAWLER_TABLE: table.tableName,
      DATA_BUCKET: bucket.bucketName,
      AI_PROVIDER: "anthropic",
      AI_API_KEY_PARAM: `/crawler/${stage}/anthropic_api_key`,
    };

    // Build the crawlWorker ARN from its explicit name so neither policy uses
    // Fn::GetAtt on the function — that would create a self-referential CDK
    // dependency (function needs policy, policy needs function ARN) and a
    // transitive cycle through StartCrawl and the API route.
    const crawlWorkerArn = cdk.Stack.of(this).formatArn({
      service: "lambda",
      resource: "function",
      resourceName: `crawler-worker-${stage}`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });

    // ── crawlWorker Lambda (define first — startCrawl needs its name) ────────
    const crawlWorkerFn = new NodejsFunction(this, "CrawlWorker", {
      ...COMMON_BUNDLE,
      functionName: `crawler-worker-${stage}`,
      entry: path.join(LAMBDA_DIR, "crawlWorker.ts"),
      handler: "handler",
      memorySize: 1024,
      timeout: cdk.Duration.minutes(14),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "CrawlWorkerLogs", {
      logGroupName: `/aws/lambda/crawler-worker-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    crawlWorkerFn.addEnvironment("CRAWL_WORKER_FUNCTION_NAME", `crawler-worker-${stage}`);
    crawlWorkerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [crawlWorkerArn],
      })
    );

    // ── startCrawl Lambda ────────────────────────────────────────────────────
    const startCrawlFn = new NodejsFunction(this, "StartCrawl", {
      ...COMMON_BUNDLE,
      functionName: `crawler-start-${stage}`,
      entry: path.join(LAMBDA_DIR, "startCrawl.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnv,
        CRAWL_WORKER_FUNCTION_NAME: `crawler-worker-${stage}`,
      },
    });
    new logs.LogGroup(this, "StartCrawlLogs", {
      logGroupName: `/aws/lambda/crawler-start-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    startCrawlFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [crawlWorkerArn],
      })
    );

    // ── querySite Lambda ─────────────────────────────────────────────────────
    const querySiteFn = new NodejsFunction(this, "QuerySite", {
      ...COMMON_BUNDLE,
      functionName: `crawler-query-${stage}`,
      entry: path.join(LAMBDA_DIR, "querySite.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "QuerySiteLogs", {
      logGroupName: `/aws/lambda/crawler-query-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    querySiteFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/crawler/${stage}/anthropic_api_key`,
        ],
      })
    );

    // ── queryAll Lambda (cross-site knowledge-base query) ───────────────────
    const queryAllFn = new NodejsFunction(this, "QueryAll", {
      ...COMMON_BUNDLE,
      functionName: `crawler-query-all-${stage}`,
      entry: path.join(LAMBDA_DIR, "queryAll.ts"),
      handler: "handler",
      memorySize: 1024,
      timeout: cdk.Duration.seconds(90),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "QueryAllLogs", {
      logGroupName: `/aws/lambda/crawler-query-all-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    queryAllFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/crawler/${stage}/anthropic_api_key`,
        ],
      })
    );

    // ── deleteSite Lambda ────────────────────────────────────────────────────
    const deleteSiteFn = new NodejsFunction(this, "DeleteSite", {
      ...COMMON_BUNDLE,
      functionName: `crawler-delete-site-${stage}`,
      entry: path.join(LAMBDA_DIR, "deleteSite.ts"),
      handler: "handler",
      memorySize: 256,
      timeout: cdk.Duration.minutes(2),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "DeleteSiteLogs", {
      logGroupName: `/aws/lambda/crawler-delete-site-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── exportMarkdown Lambda ────────────────────────────────────────────────
    const exportMarkdownFn = new NodejsFunction(this, "ExportMarkdown", {
      ...COMMON_BUNDLE,
      functionName: `crawler-export-${stage}`,
      entry: path.join(LAMBDA_DIR, "exportMarkdown.ts"),
      handler: "handler",
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "ExportMarkdownLogs", {
      logGroupName: `/aws/lambda/crawler-export-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Read Lambdas ─────────────────────────────────────────────────────────
    const getSitesFn = new NodejsFunction(this, "GetSites", {
      ...COMMON_BUNDLE,
      functionName: `crawler-get-sites-${stage}`,
      entry: path.join(LAMBDA_DIR, "getSites.ts"),
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "GetSitesLogs", {
      logGroupName: `/aws/lambda/crawler-get-sites-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const getSiteFn = new NodejsFunction(this, "GetSite", {
      ...COMMON_BUNDLE,
      functionName: `crawler-get-site-${stage}`,
      entry: path.join(LAMBDA_DIR, "getSite.ts"),
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "GetSiteLogs", {
      logGroupName: `/aws/lambda/crawler-get-site-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const getPagesFn = new NodejsFunction(this, "GetPages", {
      ...COMMON_BUNDLE,
      functionName: `crawler-get-pages-${stage}`,
      entry: path.join(LAMBDA_DIR, "getPages.ts"),
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "GetPagesLogs", {
      logGroupName: `/aws/lambda/crawler-get-pages-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const getMarkdownFn = new NodejsFunction(this, "GetMarkdown", {
      ...COMMON_BUNDLE,
      functionName: `crawler-get-markdown-${stage}`,
      entry: path.join(LAMBDA_DIR, "getMarkdown.ts"),
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "GetMarkdownLogs", {
      logGroupName: `/aws/lambda/crawler-get-markdown-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const getJobFn = new NodejsFunction(this, "GetJob", {
      ...COMMON_BUNDLE,
      functionName: `crawler-get-job-${stage}`,
      entry: path.join(LAMBDA_DIR, "getJob.ts"),
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
    });
    new logs.LogGroup(this, "GetJobLogs", {
      logGroupName: `/aws/lambda/crawler-get-job-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── IAM: grant least-privilege access ────────────────────────────────────
    const allLambdas = [
      startCrawlFn,
      crawlWorkerFn,
      querySiteFn,
      queryAllFn,
      deleteSiteFn,
      exportMarkdownFn,
      getSitesFn,
      getSiteFn,
      getPagesFn,
      getMarkdownFn,
      getJobFn,
    ];

    // DynamoDB
    table.grantReadWriteData(startCrawlFn);
    table.grantReadWriteData(crawlWorkerFn);
    table.grantReadWriteData(querySiteFn);
    table.grantReadWriteData(queryAllFn);
    table.grantReadWriteData(deleteSiteFn);
    table.grantReadData(exportMarkdownFn);
    table.grantReadData(getSitesFn);
    table.grantReadData(getSiteFn);
    table.grantReadData(getPagesFn);
    table.grantReadData(getMarkdownFn);
    table.grantReadData(getJobFn);

    // S3
    bucket.grantReadWrite(startCrawlFn);
    bucket.grantReadWrite(crawlWorkerFn);
    bucket.grantRead(querySiteFn);
    bucket.grantRead(queryAllFn);
    bucket.grantReadWrite(deleteSiteFn); // delete needs List + DeleteObject
    bucket.grantReadWrite(exportMarkdownFn);
    bucket.grantRead(getMarkdownFn);

    // ── API Gateway HTTP API ─────────────────────────────────────────────────
    const api = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: `crawler-api-${stage}`,
      corsPreflight: {
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"], // Restrict to Amplify domain in production
        maxAge: cdk.Duration.hours(1),
      },
    });

    const apiLogGroup = new logs.LogGroup(this, "ApiLogs", {
      logGroupName: `/crawler/${stage}/api`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    api.addRoutes({
      path: "/crawl",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("StartCrawl", startCrawlFn),
    });

    api.addRoutes({
      path: "/sites",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetSites", getSitesFn),
    });

    api.addRoutes({
      path: "/sites/{siteId}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetSite", getSiteFn),
    });

    api.addRoutes({
      path: "/sites/{siteId}",
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("DeleteSite", deleteSiteFn),
    });

    api.addRoutes({
      path: "/query",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("QueryAll", queryAllFn),
    });

    api.addRoutes({
      path: "/sites/{siteId}/pages",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetPages", getPagesFn),
    });

    api.addRoutes({
      path: "/sites/{siteId}/pages/{pageId}/markdown",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetMarkdown", getMarkdownFn),
    });

    api.addRoutes({
      path: "/sites/{siteId}/query",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("QuerySite", querySiteFn),
    });

    api.addRoutes({
      path: "/sites/{siteId}/export",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("ExportMarkdown", exportMarkdownFn),
    });

    api.addRoutes({
      path: "/jobs/{siteId}/{jobId}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetJob", getJobFn),
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, "TableName", {
      value: table.tableName,
    });

    new cdk.CfnOutput(this, "SsmKeyPath", {
      value: `/crawler/${stage}/anthropic_api_key`,
      description: "SSM path — set the Anthropic API key here before deploying",
    });
  }
}
