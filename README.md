# AI workflow helper

Allows users to select multiple files across multiple folders, right-click on them, and copy their contents into the clipboard as one text stream. Each file's content will be preceded by its filename, and the files and folders will be placed in the text stream in the order they were selected.

Additionally, it provides automatic file inclusion functionality that allows you to include content from other files with real-time synchronization.

## Features

### File Copying
- Right-click on files to copy their contents as a text stream
- Copy multiple files and folders in the order they were selected
- File contents are formatted with clear separators and filenames
- Works across multiple folders in your workspace

### File Inclusion (New!)
- Include content from other files using the `// @include path/to/file` syntax
- Automatic content synchronization when included files change
- Supports both relative and absolute paths
- Preserves original file structure

## Usage

### Copying Files
1. Select one or more files in the VS Code explorer
2. Right-click and select "Copy Files as Text Stream"
3. The contents will be copied to your clipboard with filenames as headers

### Copying Files and Folders
1. Select one or more folders in the VS Code explorer
2. Right-click and select "Copy Files and Files in Folders as Text Stream"
3. All files within the selected folders will be copied to your clipboard

### File Inclusion
1. Add an include directive in your file:
```
some static text
// @include ./other-file.txt
more static text
```
2. The content from `other-file.txt` will be automatically included
3. When `other-file.txt` changes, the content will automatically update
4. You can also manually trigger scanning using the "Scan File for Includes" command from the editor context menu

## Configuration

You can customize the extension's behavior through VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `aiWorkflowHelper.includePattern` | Pattern to use for file inclusion | `@include` |
| `aiWorkflowHelper.autoScanIncludes` | Automatically scan files for includes when opened | `true` |

## Example Output

### File Copying
```
--- src/file1.ts ---
content of file1

--- src/utils/file2.ts ---
content of file2

--- src/components/file3.ts ---
content of file3
```

### File Inclusion
```typescript
// Original file:
const config = {
  // @include ./config/default.json
};

// After inclusion:
const config = {
  "port": 3000,
  "debug": true,
  "database": {
    "host": "localhost",
    "port": 5432
  }
};
```

## Requirements
- VS Code version 1.94.0 or higher

## Extension Settings
This extension contributes the following settings:
* `aiWorkflowHelper.includePattern`: Configure the pattern used for file inclusion
* `aiWorkflowHelper.autoScanIncludes`: Enable/disable automatic scanning of files for includes

## Known Issues
None reported.

## Contributing
Feel free to submit issues and enhancement requests on the GitHub repository.

## License
This extension is licensed under the [MIT License](LICENSE).