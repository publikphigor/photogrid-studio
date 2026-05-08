# Source of fish helpers. The `install.fish` script splits this into one
# function file per command and writes them to ~/.config/fish/functions/, with
# the project path interpolated. That way fish autoloads them and you can call
# `pg-up`, `pg-build`, etc., from anywhere.

# function-spec lines below are read by install.fish.
# format: <name>|<make-target>|<description>
#NAME pg-up      | up      | PhotoGrid: bring stack up
#NAME pg-build   | build   | PhotoGrid: build images
#NAME pg-rebuild | rebuild | PhotoGrid: build + restart
#NAME pg-restart | restart | PhotoGrid: restart services
#NAME pg-down    | down    | PhotoGrid: stop stack
#NAME pg-logs    | logs    | PhotoGrid: follow logs
#NAME pg-clean   | clean   | PhotoGrid: down + drop cache
#NAME pg-prod    | prod-up | PhotoGrid: prod stack up
#NAME pg-test    | test    | PhotoGrid: run all tests
