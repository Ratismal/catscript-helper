const vscode = require('vscode');
const path = require('path');

let runners = {};

class Runner {
  constructor(name, parent, commands) {
    this.name = name;
    this.parent = parent;

    this.commands = commands;
  }
}

async function parseSchema(runnerName) {
  if (runners[runnerName]) return;

  try {
    const files = await vscode.workspace.findFiles('**/.catscript/schemas/' + runnerName + '.json');
    if (files.length > 0) {
      const document = await vscode.workspace.openTextDocument(files[0]);
      const text = document.getText();

      const obj = JSON.parse(text);

      let commands = obj.commands;
      if (obj.extends) {
        await parseSchema(obj.extends);

        const extended = runners[obj.extends];
        commands = extended.commands;

        for (const key of Object.keys(obj.commands)) {
          if (obj.commands.hasOwnProperty(key)) {
            commands[key] = obj.commands[key];
          }
        }
      }

      runners[runnerName] = new Runner(runnerName, obj.extends, commands);
    }

    console.log(runners);
  } catch (err) {
    console.error(err);
  }
}

function findRunner(document) {
  const text = document.getText();
  const meta = text.match(/^\/\/\/\s*runner:\s*(.+)\s*$/m);

  if (meta && meta[1]) {
    return meta[1];
  }

  return 'obj_cat_script_runner';
}

vscode.languages.registerHoverProvider('catscript', {
  async provideHover(document, position, token) {
    const runnerKey = findRunner(document);
    await parseSchema(runnerKey);

    const runner = runners[runnerKey];

    const range = document.getWordRangeAtPosition(position);
    const word = document.getText(range).toUpperCase();
    console.log(word, range.start.character);
    
    if (range.start.character === 0) {
      const command = runner.commands[word];

      const res = getCommandDescriptor(runnerKey, word);
      console.log(res);

      if (command) {
        return new vscode.Hover(res);
      }
    }
  }
});

function getCommandDescriptor(runnerKey, commandName) {
  const runner = runners[runnerKey];
  const command = runner.commands[commandName.toUpperCase()];
  if (command) {
    let title = [command.command];

    for (let i = 0; i < command.args.length; i++) {
      title.push(`@${command.argLabels[i]}:${command.args[i]}`);
    }

    let string = new vscode.MarkdownString().appendCodeblock(title.join(' '), "catscript")
    if (command.output) {
      string = string.appendCodeblock('-> ' + command.output.join(', '));
    }
    string = string.appendMarkdown(command.desc);

    return string;
  }
}

vscode.languages.registerCompletionItemProvider('catscript', {
  async provideCompletionItems(document, position, token, context) {
    // console.log(document, position, token, context);
    const runnerKey = findRunner(document);
    await parseSchema(runnerKey);

    const runner = runners[runnerKey];

    const items = [];

    for (const key of Object.keys(runner.commands)) {
      if (runner.commands.hasOwnProperty(key)) {
        const command = runner.commands[key];

        const item = new vscode.CompletionItem(command.command);
        item.documentation = getCommandDescriptor(runnerKey, command.command);

        items.push(item);
      }
    }

    return items;
  }
});

vscode.commands.registerCommand('catscript-helper.parseGameMaker', async (args) => {
  runners = {};

  const files = await vscode.workspace.findFiles("**/*script_runner*.yy");
  if (files.length === 0) return;

  const parsedRunners = {};

  async function parseGamemakerRunner(file) {
    const document = await vscode.workspace.openTextDocument(file);
    const manifestContent = document.getText()
      .replace(/,\s*([\]\}])/gm, '$1');
    const obj = JSON.parse(manifestContent);

    if (parsedRunners[obj.name]) {
      return;
    }

    let extendsName = undefined;

    if (obj.parentObjectId) {
      extendsName = obj.parentObjectId.name;
    }

    const document2 = await vscode.workspace.openTextDocument(path.join(file.path, '..', 'Create_0.gml'));
    const content = document2.getText();
    const lines = content.replace(/\r/g, '').split('\n');

    const commands = {};
    let command = {};
    for (const line of lines) {
      if (line !== '' && !line.startsWith('///')) {
        command = {};
        continue;
      }

      if (line.startsWith('///')) {
        const parts = line.substring(3).trim().split(' ');
        switch (parts[0].toLowerCase()) {
          case '@func':
          case '@function':
          case '@method':
            command = {
              command: parts[1],
              desc: '',
              args: [],
              argLabels: [],
              output: []
            };
            break;
          case '@ignore':
            commands[command.command] = command;
            break;
          case '@description':
          case '@desc':
            for (let i = 1; i < parts.length; i++) {
              if (parts[i] != '') {
                const desc = parts.slice(i).join(' ').trim();
                command.desc += (command.desc === '' ? '' : '\n\n') + desc;
                break;
              }
            }
            break;
          case '@arg':
          case '@argument':
          case '@param':
          case '@parameter':
            let i = 1;
            let type = 'any';
            let label = 'value';
            for (; i < parts.length; i++) {
              if (parts[i] != '') {
                type = parts[i];
                break;
              }
            }
            for (i++; i < parts.length; i++) {
              if (parts[i] != '') {
                label = parts[i];
                break;
              }
            }
            command.args.push(type);
            command.argLabels.push(label);
            break;
          case '@return':
          case '@returns':
            for (let i = 1; i < parts.length; i++) {
              if (parts[i] != '') {
                command.output.push(parts[i]);
              }
            }
            break;
        }
      }
    }

    const runner = {
      extends: extendsName,
      commands
    };

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(file).uri;
    const dir = vscode.Uri.joinPath(workspaceFolder, '.catscript', 'schemas');
    await vscode.workspace.fs.createDirectory(dir);
    const fileDir = vscode.Uri.joinPath(dir, obj.name + '.json');
    await vscode.workspace.fs.writeFile(fileDir, new TextEncoder("utf-8").encode(JSON.stringify(runner, null, 2)));
  }

  for (const file of files) {
    try {
      await parseGamemakerRunner(file);
    } catch (err) {
      console.log('Failed to parse runner', file.path);
      console.error(err);
    }
  }
});