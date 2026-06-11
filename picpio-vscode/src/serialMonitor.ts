import { SerialMonitorPanel } from './serialMonitorPanel';

export async function openSerialMonitor(): Promise<void> {
    SerialMonitorPanel.createOrShow();
}
