import { z } from "zod";
import { deviceRequestSchema } from "../contract/schema.js";
import type { DeviceRequest } from "../contract/schema.js";
import { readJsonState, writeJsonState } from "../core/jsonState.js";

const deviceSchema = deviceRequestSchema.extend({ registeredAt: z.iso.datetime() });
const storeFileSchema = z.strictObject({ devices: z.array(deviceSchema) });

export type Device = z.infer<typeof deviceSchema>;

export type DeviceStore = {
  list(): Device[];
  upsert(device: DeviceRequest): void;
  remove(apnsToken: string): void;
};

const readDevices = (path: string): Device[] => readJsonState(path, storeFileSchema, "device store", { devices: [] }).devices;

export function createDeviceStore(path: string, now: () => Date): DeviceStore {
  return {
    list: (): Device[] => readDevices(path),
    upsert(device): void {
      const entry: Device = { ...device, registeredAt: now().toISOString() };
      const devices = readDevices(path);
      const index = devices.findIndex((existing) => existing.apnsToken === device.apnsToken);
      if (index === -1) devices.push(entry);
      else devices[index] = entry;
      writeJsonState(path, { devices });
    },
    remove(apnsToken): void {
      const devices = readDevices(path);
      writeJsonState(path, { devices: devices.filter((existing) => existing.apnsToken !== apnsToken) });
    },
  };
}
