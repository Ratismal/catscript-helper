const vscode = require('vscode');
const path = require('path');

let runners = {};

class Runner {
  constructor(name, scopes) {
    this.name = name;

    this.scopes = scopes;
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

      let scopes = obj.scopes;

      runners[runnerName] = new Runner(runnerName, scopes);
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

    const line = document.lineAt(position);

    const matches = line.text.match(/^(@[A-z0-9_\-]+:\s+)?([A-Z_.]+)\!?/);

    if (matches === null) {
      return;
    }

    if (position.character < matches[0].length) {
      const parts = matches[2].split('.');
      
      if (parts.length === 0) {
        return;
      }
      if (parts.length === 1) {
        parts.unshift('BASE');
      }

      const scope = runner.scopes[parts[0]];
      if (scope) {
        const command = scope[parts[1]];

        if (command) {
          const res = getCommandDescriptor(runnerKey, parts[0], parts[1]);

          return new vscode.Hover(res);
        }
      }
    }
  }
});

function getCommandDescriptor(runnerKey, scopeName, commandName) {
  const runner = runners[runnerKey];
  const scope = runner.scopes[scopeName] ?? {};
  const command = scope[commandName.toUpperCase()];
  if (command) {
    let title = [command.command];
    if (scopeName !== 'BASE') {
      title[0] = `${scopeName}.${title[0]}`;
    }

    for (const arg of command.args) {
      title.push(`@${arg.name}:${arg.optional ? '!' : ''}${arg.type}`)
    }
    // for (let i = 0; i < command.args.length; i++) {
    //   title.push(`@${command.argLabels[i]}:${command.args[i]}`);
    // }

    let string = new vscode.MarkdownString().appendCodeblock(title.join(' '), "catscript")
    if (command.output.length > 0) {
      string = string.appendCodeblock('-> ' + command.output.join(', '));
    }
    string = string.appendMarkdown(command.desc);

    return string;
  }
}

function getCompletionCommands(runner, scopeName, full = false) {
  const items = [];

  if (runner.scopes.hasOwnProperty(scopeName)) {
    const scope = runner.scopes[scopeName];

    for (const commandKey of Object.keys(scope)) {
      if (scope.hasOwnProperty(commandKey)) {
        const command = scope[commandKey];

        const item = new vscode.CompletionItem(command.scope + '.' + command.command, vscode.CompletionItemKind.Function);
        if (full && scopeName === 'BASE') {
          item.label = command.command;
        }
        if (!full) {
          item.insertText = command.command;
          item.sortText = command.command;
        }
        item.documentation = getCommandDescriptor(runner.name, command.scope, command.command);

        items.push(item);
      }
    }
  }

  return items;
}

vscode.languages.registerCompletionItemProvider('catscript', {
  async provideCompletionItems(document, position, token, context) {
    const start = document.getText(new vscode.Range(position.with(position.line, 0), position.translate(0, -1)));
    console.log(start);
    if (/((^|\s)[A-Z_.]+)\s/.test(start)) {
      return [];
    }



    console.log(document, position, token, context, context.triggerCharacter);
    const runnerKey = findRunner(document);
    await parseSchema(runnerKey);
    const runner = runners[runnerKey];
    let items = [];


    if (context.triggerCharacter === '.') {
      const wordRange = document.getWordRangeAtPosition(position.translate(0, -2));
      console.log(position, position.translate(0, -2), wordRange);
      const word = document.getText(wordRange);

      items = getCompletionCommands(runner, word);

    } else {
      let commands = [];
      for (const key of Object.keys(runner.scopes)) {
        if (runner.scopes.hasOwnProperty(key)) {
          const scope = runner.scopes[key];
          
          const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
          items.push(item);

          commands = commands.concat(getCompletionCommands(runner, key, true));
        }
      }

      items = items.concat(commands);
    }

    return items;




    // for (const key of Object.keys(runner.scopes)) {
    //   if (runner.scopes.hasOwnProperty(key)) {
    //     const scope = runner.scopes[key];
        
    //     // const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Module);
    //     // items.push(item);

    //     for (const commandKey of Object.keys(scope)) {
    //       if (scope.hasOwnProperty(commandKey)) {
    //         const command = scope[commandKey];

    //         const item = new vscode.CompletionItem(command.command, vscode.CompletionItemKind.Function);
    //         item.label = key + '.' + command.command;
    //         item.insertText = command.command;
    //         item.documentation = getCommandDescriptor(runnerKey, command.scope, command.command);
    
    //         items.push(item);
    //       }
    //     }
    //   }
    // }

    // console.log(items);

  }
}, '.');
