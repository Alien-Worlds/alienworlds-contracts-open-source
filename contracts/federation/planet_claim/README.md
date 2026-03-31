**Building the Docker Image**: Open a terminal or command prompt, navigate to the directory containing the Dockerfile and application files, and run the following command to build the Docker image:

```bash
docker build --no-cache -t ghcr.io/alien-worlds/alienworlds:claim-latest
```

As this script does not have any versioning, short commit hash could be used to distinguish between different image versions:

```bash
docker build --no-cache -t ghcr.io/alien-worlds/alienworlds:claim-a3e4bb5
```

if necessary, push to Github package registry (prior authentication would be required)

```bash
docker push ghcr.io/alien-worlds/alienworlds:claim-a3e4bb5
```

**Running the docker image**: as single image contains 2 scripts we will need to override default startup command. Also we will need to provide correct configuration files to both scripts (planet claim script requires authorization with `claim` permission for 6 planet accounts - `eyeke.world`, `kavian.world`, `magor.world`, `naron.world`, `neri.world`, `veles.world`; inflate script requires authorization with `claim` permission for `federation` account). One way to do this is via bind mounts in `docker-compose.yml` file:

```yaml
version: '3.7'
services:
planet-claim:
    image: ghcr.io/alien-worlds/alienworlds:claim-a3e4bb5
    command:
        ['npm', 'run', 'planet-claim']
    restart: on-failure
    volumes:
        - ./config/planet-claim-config.js:/var/scripts/alienworlds/config.js

land-inflate:
    image: ghcr.io/alien-worlds/alienworlds:claim-a3e4bb5
    command:
        ['npm', 'run', 'land-inflate']
    restart: on-failure
    volumes:
        - ./config/land-inflate-config.js:/var/scripts/alienworlds/config.js
```

After executing `docker-compose up -d` command 2 containers will be started - one for planet claim script and second for inflate script.