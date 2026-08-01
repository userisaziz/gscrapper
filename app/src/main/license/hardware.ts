import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";

/**
 * Generates a stable hardware fingerprint for this machine.
 * Combines platform-specific machine identifiers with hostname and MAC address,
 * then returns a SHA-256 hex hash.
 */
export function hardwareId(): string {
  const components: string[] = [];

  const machineId = platformMachineId();
  if (machineId) components.push(machineId);

  const hostname = os.hostname();
  if (hostname) components.push(hostname);

  const mac = primaryMac();
  if (mac) components.push(mac);

  if (components.length === 0) {
    throw new Error("Unable to generate hardware fingerprint: no identifiers available");
  }

  return crypto.createHash("sha256").update(components.join("|")).digest("hex");
}

function platformMachineId(): string {
  try {
    switch (process.platform) {
      case "darwin":
        return darwinMachineId();
      case "win32":
        return windowsMachineId();
      case "linux":
        return linuxMachineId();
      default:
        return "";
    }
  } catch {
    return "";
  }
}

function darwinMachineId(): string {
  const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", { encoding: "utf-8" });
  for (const line of out.split("\n")) {
    if (line.includes("IOPlatformUUID")) {
      const parts = line.split('"');
      if (parts.length >= 4) return parts[3]!;
    }
  }
  return "";
}

function windowsMachineId(): string {
  const out = execSync(
    'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
    { encoding: "utf-8" }
  );
  for (const line of out.split("\n")) {
    if (line.includes("MachineGuid")) {
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1]!;
    }
  }
  return "";
}

function linuxMachineId(): string {
  try {
    return fs.readFileSync("/etc/machine-id", "utf-8").trim();
  } catch {
    try {
      return fs.readFileSync("/var/lib/dbus/machine-id", "utf-8").trim();
    } catch {
      return "";
    }
  }
}

function primaryMac(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.mac && addr.mac !== "00:00:00:00:00:00") {
        return addr.mac;
      }
    }
  }
  return "";
}

export function deviceName(): string {
  const hostname = os.hostname();
  return `${hostname} (${process.platform}/${process.arch})`;
}
