declare module "aws-lambda" {
  export interface APIGatewayProxyEventV2 {
    body?: string | null;
    pathParameters?: Record<string, string | undefined>;
  }

  export interface APIGatewayProxyResultV2 {
    statusCode?: number;
    headers?: Record<string, string | number | boolean>;
    body?: string;
    isBase64Encoded?: boolean;
  }

  export interface Context {
    getRemainingTimeInMillis(): number;
  }
}
