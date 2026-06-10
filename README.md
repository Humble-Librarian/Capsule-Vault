# Capsule Vault

Privacy-first local text capsules for repeated context, notes, prompts, and snippets.

## Privacy

- No account required
- No servers, sync, telemetry, or network requests
- Data is stored locally in IndexedDB
- Import, export, and clear-all controls are built into the popup
- The floating capture button is off by default

## Permissions

Capsule Vault uses the smallest practical MV3 permission set:

- `storage` for local settings
- `activeTab` and `scripting` for user-triggered page capture/injection
- `contextMenus` for right-click "Save to Capsule"

There are no host permissions, no `<all_urls>`, and no persistent content scripts.

## Usage

### Save selected text

1. Select text on any normal web page.
2. Right-click and choose **Save to Capsule**.
3. Or press `Ctrl+Shift+S` to open the save dialog for the selected text.

### Save manually

1. Open the extension popup.
2. Click `+`.
3. Paste content and optionally add a title and tags.

If the title is blank, Capsule Vault generates one from the first meaningful line of content.

### Search and manage

- Search matches title, content, and tags in real time.
- Cards show title, two-line preview, source, date, tags, and actions.
- Actions: inject, edit, copy, delete.
- Pin important capsules from the edit dialog.
- The vault keeps up to 250 capsules to avoid performance degradation.

### Floating Capture

The popup includes an **Enable Floating Capture** toggle. It is off by default and only injects UI into the active tab after you enable it.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` | Save selected text |
| `Ctrl+Shift+O` | Open the extension popup |
| `Ctrl+F` | Focus popup search |
| `Ctrl+Enter` | Save from the page capture dialog |
| `Escape` | Close dialogs |

## Data Format

```json
{
  "id": "cv_abc123_xyz",
  "title": "Fix chrome extension bug",
  "content": "Fix chrome extension bug in manifest...",
  "tags": ["code", "todo"],
  "source": "Manual",
  "url": "",
  "pinned": false,
  "createdAt": 1718000000000,
  "updatedAt": 1718000000000,
  "version": 1
}
```

## File Structure

```text
capsule-vault/
|-- manifest.json
|-- popup.html
|-- popup.css
|-- popup.js
|-- icons/
|   |-- icon16.png
|   |-- icon48.png
|   `-- icon128.png
`-- src/
    |-- background.js
    |-- content.js
    |-- content.css
    `-- db.js
```
