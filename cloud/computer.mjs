/* ══════════════════════════════════════════════════════════════════════════
   AMV'S CLOUD COMPUTER - one container per person, running the AMV bridge.

   A Worker of its own (deployed from this folder, wrangler.toml here), so the
   main Worker never imports the container runtime: it reaches these through a
   Durable Object binding by name (AMV_COMPUTER, script_name "amv-computer").

   Each person's container is a separate instance, started on first use and
   asleep after ten minutes with nothing to do. Inside it is the same bridge
   people run on their own machines, in --cloud mode: no pairing, no screen,
   and every request must carry the key this Worker starts it with. Nothing
   outside reaches the container's port - only the Durable Object below.

   It may reach the internet (installing packages, cloning repositories), and
   it may not reach private and internal addresses: the cloud provider's
   metadata service and the private ranges are refused before they leave. */
import { Container } from '@cloudflare/containers';
export { ContainerProxy } from '@cloudflare/containers';

export class AMVComputer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = true;
  deniedHosts = [
    'localhost', '*.localhost', '*.internal', 'metadata', 'metadata.*',
    '169.254.*', '127.*', '0.*', '10.*', '192.168.*',
    '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*',
    '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*',
    '100.64.*', '[*',
  ];
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { AMV_CLOUD_KEY: String((env && env.AMV_COMPUTER_KEY) || ''), PORT: '8080' };
  }
}

/* Nothing is served from this Worker directly. */
export default {
  async fetch() { return new Response('Not found', { status: 404 }); },
};
