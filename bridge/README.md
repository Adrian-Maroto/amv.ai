# The AMV Bridge

AMV runs in a browser tab, and its server is a Worker. Neither can start a
process, install a package or hold a filesystem, so AMV could write code and
never run it.

The bridge is the missing machine: a small program you run yourself, in the
folder you want AMV to work in. While it is running, AMV can install
dependencies, run builds and tests, use git, read and write files, and fix
what breaks - in that one folder, on your computer, with your toolchain.

It is one file, it has no dependencies, and it stops when you close it.

## Running it

In the folder you want AMV to work in:

```
node /path/to/amv/bridge/amv-bridge.mjs
```

Or point it at a folder from anywhere:

```
node bridge/amv-bridge.mjs ~/code/my-project
```

It prints a port and a pairing code. In AMV, open **Integrations** and find
**Connect this computer** at the top, type both in, and connect. That is the
whole setup.

The code changes every time the bridge starts, and the connection ends when
you close the tab or close the bridge. Neither is stored anywhere.

## What AMV can and cannot do through it

**Can**, inside the folder you started it in, and nowhere else:

- run shell commands and read back stdout, stderr and the exit code
- read a file, write a file (creating folders as needed), list a directory

**Cannot**, and these are refused by the bridge itself rather than by asking
the model nicely:

- touch anything outside that folder, including through `..` or a symlink
- `rm -rf`, `mkfs`, `dd of=/dev/…`, a shutdown, or a fork bomb
- `sudo`
- `git push --force` (`--force-with-lease` is fine, and still runs)
- pipe a download straight into a shell (`curl … | sh`)

Every command runs with a timeout, and the timeout kills the whole process
tree rather than only the shell that started it.

## Why it is safe to leave running

The danger of a program listening on your machine is not the program you
meant to talk to - it is every other page in your browser, and everything
else on loopback. So:

- **Loopback only.** It never binds a public interface.
- **A pairing code**, shown only in your terminal. An unpaired page can do
  nothing at all, so a site that guesses the port still gets nothing.
- **An allowlisted origin.** Even paired, requests from anywhere that is not
  AMV are refused.
- **Root confinement** on every path, resolved through symlinks, checked
  separately for reading, writing and deleting.
- **No secrets to leak.** Commands run with the bridge's own token stripped
  from their environment.

Before pairing, the only thing it will tell a page is the folder's *name* -
never its path, which is usually somebody's home directory and often their
real name.

## Getting hold of it

The build writes this file to the root of the deployment, beside `index.html`
and `sw.js`, and the connect card fetches it when you press **Download
amv-bridge.mjs** - same origin, same connection, no package registry
involved. What you get is byte-for-byte the file in this folder, and a suite
checks that so the copy people run can never drift from the copy the tests
drive.

It is fetched rather than carried in the page: embedding it cost about 7KB
gzipped on every page load, which is the wrong trade for a file only
developers download, and the page-weight ceiling said so.

If the fetch fails - an older deployment, a host that does not serve the
file - the card says so and points here rather than saving you something
that is not the bridge.

## Working on AMV itself

Set `AMV_BRIDGE_DEV=1` to also accept a loopback origin, so a local build of
AMV can pair with it:

```
AMV_BRIDGE_DEV=1 node bridge/amv-bridge.mjs
```

This widens who may knock. The pairing code is unchanged, and everything else
is the same.
