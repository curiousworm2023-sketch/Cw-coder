import { openSerialMonitor as openSerialMonitorPage } from './serialMonitorServer';

export async function openSerialMonitor(): Promise<void> {
    await openSerialMonitorPage();
}
