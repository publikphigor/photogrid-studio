#!/usr/bin/env fish
# Install PhotoGrid Studio fish functions to ~/.config/fish/functions/.
# Idempotent: re-running overwrites existing function files.

set -l script_dir (status dirname)
set -l project_dir (cd "$script_dir/../.." && pwd)
set -l target_dir "$HOME/.config/fish/functions"
mkdir -p "$target_dir"

set -l spec_file "$script_dir/photogrid.fish"
if not test -f "$spec_file"
    echo "error: missing $spec_file" >&2
    exit 1
end

set -l installed
for line in (string match -r '^#NAME .*' < "$spec_file")
    # strip leading "#NAME "
    set -l body (string sub --start 7 -- $line)
    # split on `|`, trimming whitespace around each field
    set -l parts (string split '|' -- $body)
    if test (count $parts) -ne 3
        continue
    end
    set -l name        (string trim -- $parts[1])
    set -l make_target (string trim -- $parts[2])
    set -l description (string trim -- $parts[3])
    set -l file "$target_dir/$name.fish"
    printf 'function %s --description "%s"\n    make -C "%s" %s $argv\nend\n' \
        $name $description $project_dir $make_target > $file
    set installed $installed $name
end

echo "installed: $installed"
echo "target:    $target_dir"
echo "open a new fish session and try: pg-up"
