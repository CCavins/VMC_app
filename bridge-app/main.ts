/**
 * Downloadable VMC Bridge. Receives the phone's UDP stream and lets the deployed
 * site (https://ccavins.github.io/VMC_app/) connect to ws://127.0.0.1:8787.
 */
import { startBridge } from '../server/index';

process.title = 'VMC Bridge';

const openBrowser = process.env.BRIDGE_OPEN !== '0';
startBridge({
  host: process.env.BRIDGE_HOST || '127.0.0.1',
  companion: true,
  openBrowser,
});
