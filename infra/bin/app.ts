#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CrawlerStack } from "../lib/crawler-stack";

const app = new cdk.App();

const stage = app.node.tryGetContext("stage") ?? "dev";

new CrawlerStack(app, `CrawlerStack-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
