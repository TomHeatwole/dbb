import sys
import json
import os


def pretty_print_json_file(filepath):
    if not os.path.isfile(filepath):
        print(f"Error: File '{filepath}' does not exist.")
        return
    with open(filepath, 'r') as f:
        content = f.read().strip()
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"Error: Failed to parse JSON. {e}")
            return
        print(json.dumps(data, indent=2))


def main():
    if len(sys.argv) != 2:
        print(f"Usage: python {os.path.basename(__file__)} <path_to_json_file>")
        sys.exit(1)
    filepath = sys.argv[1]
    pretty_print_json_file(filepath)


if __name__ == "__main__":
    main() 