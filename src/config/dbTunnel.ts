// src/config/dbTunnel.ts
import { createTunnel } from "tunnel-ssh";
import fs from "fs";
import { env } from "./env.js";

let tunnelServer: any = null;
let sshClient: any = null;

export async function createDbTunnel(): Promise<void> {
  if (!env.ssh.enabled) {
    console.log("SSH tunnel disabled – connecting directly to DB");
    return;
  }

  const privateKey = fs.readFileSync(env.ssh.keyPath);

  const tunnelOptions = {
    autoClose: false,
    reconnectOnError: true,
  };

  const serverOptions = {
    port: env.ssh.localPort,
  };

  const forwardOptions = {
    srcAddr: "127.0.0.1",
    srcPort: env.ssh.localPort,        // local port (e.g. 5433)
    dstAddr: env.db.host,              // your RDS host
    dstPort: env.db.port || 5432,
  };

  const sshOptions = {
    host: env.ssh.host,
    port: env.ssh.port,
    username: env.ssh.username,
    privateKey,
    keepaliveInterval: 30000,
  };

  console.log(`Creating SSH tunnel: 127.0.0.1:${env.ssh.localPort} → ${env.db.host}:${env.db.port}`);

  try {
    [tunnelServer, sshClient] = await createTunnel(
      tunnelOptions,
      serverOptions,
      sshOptions,
      forwardOptions
    );

    console.log(`SSH tunnel established on local port ${env.ssh.localPort}`);

    process.on("SIGINT", closeTunnel);
    process.on("SIGTERM", closeTunnel);
    process.on("exit", closeTunnel);
  } catch (err: any) {
    console.error("Failed to create SSH tunnel:", err.message);
    throw err;
  }
}

function closeTunnel() {
  if (tunnelServer) {
    console.log("Closing SSH tunnel server...");
    tunnelServer.close();
    tunnelServer = null;
  }
  if (sshClient) {
    console.log("Ending SSH connection...");
    sshClient.end();
    sshClient = null;
  }
}

export function getDbHost(): string {
  return env.nodeEnv === "development" && env.ssh.enabled ? "127.0.0.1" : env.db.host;
}

export function getDbPort(): number {
  return env.nodeEnv === "development" && env.ssh.enabled ? env.ssh.localPort : env.db.port;
}