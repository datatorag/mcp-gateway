export interface McpGatewayManifest {
  name: string;
  description?: string;
  version?: string;
  icon?: string;
  categories?: string[];
  author?: {
    name: string;
    url?: string;
  };
  server: {
    transport: "streamable-http";
    port: number;
    path: string;
    healthCheckPath?: string;
  };
  env?: {
    required?: string[];
    optional?: string[];
  };
  oauth?: {
    provider: string;
    authorizeUrl: string;
    tokenUrl: string;
    clientIdEnv: string;
    clientSecretEnv: string;
    scopes: string[];
    [key: string]: string | string[];
  };
}
