# The config is baked into the image rather than bind-mounted from the host.
#
# A bind mount looked simpler, but Docker creates the host path as an empty
# DIRECTORY when it doesn't exist yet, and then fails forever after with
# "are you trying to mount a directory onto a file" — because /etc/caddy/Caddyfile
# is a file. That failure mode bit us on Hostinger's Docker Manager, which does
# not necessarily stage the repo where compose expects it.
#
# Trade-off: editing the config now needs a rebuild, not just a restart:
#   docker compose up -d --build caddy
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
