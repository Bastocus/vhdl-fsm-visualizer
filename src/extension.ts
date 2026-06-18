import * as vscode from 'vscode';
import { VhdlFsmParser } from './parser';
import { FsmPanel } from './panel';

let lastDocUri: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('[VHDL FSM Diagram] Extension activated');

  // ── Command: Show Diagram ──────────────────────────────────────────────
  const showCmd = vscode.commands.registerCommand(
    'vhdl-fsm-diagram.showDiagram',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor found.');
        return;
      }

      const doc = editor.document;
      if (!isVhdlDocument(doc)) {
        vscode.window.showWarningMessage(
          'This command only works on VHDL files (.vhd, .vhdl).'
        );
        return;
      }

      openDiagram(doc, context.extensionUri, true);
    }
  );

  // ── Auto-refresh on save ───────────────────────────────────────────────
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    const config = vscode.workspace.getConfiguration('vhdl-fsm-diagram');
    if (!config.get<boolean>('autoRefresh', true)) return;
    if (!isVhdlDocument(doc)) return;
    if (!FsmPanel.currentPanel) return;
    if (FsmPanel.currentPanel.locked) return;
    if (doc.uri.toString() !== lastDocUri) return;

    const parser = new VhdlFsmParser();
    const result = parser.parse(doc.getText());

    if (result.errors.length > 0) {
      console.warn('[VHDL FSM] Parse errors:', result.errors);
    }

    const title = getDocumentTitle(doc);
    FsmPanel.currentPanel.update(result.fsms, title, doc.uri);
  });

  // ── Auto-refresh on active editor change ──────────────────────────────
  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (!editor) return;
      if (!isVhdlDocument(editor.document)) return;
      if (!FsmPanel.currentPanel) return;

      updatePanelContent(editor.document);
    }
  );

  context.subscriptions.push(showCmd, onSave, onEditorChange);
}

function openDiagram(
  doc: vscode.TextDocument,
  extensionUri: vscode.Uri,
  preserveFocus = false
): void {
  lastDocUri = doc.uri.toString();

  const parser = new VhdlFsmParser();
  const source = doc.getText();
  const result = parser.parse(source);

  if (result.errors.length > 0) {
    console.warn('[VHDL FSM] Parse errors:', result.errors);
  }

  if (result.fsms.length === 0) {
    vscode.window.showInformationMessage(
      'No FSM found in this VHDL file. Make sure you have an enum type and a case statement on a signal of that type.'
    );
    // Still open the panel (it shows the empty state UI)
  }

  const title = getDocumentTitle(doc);
  FsmPanel.createOrShow(extensionUri, result.fsms, title, doc.uri, preserveFocus);
}

function updatePanelContent(doc: vscode.TextDocument): void {
  if (!FsmPanel.currentPanel) return;
  if (FsmPanel.currentPanel.locked) return;

  lastDocUri = doc.uri.toString();
  const parser = new VhdlFsmParser();
  const result = parser.parse(doc.getText());
  if (result.errors.length > 0) {
    console.warn('[VHDL FSM] Parse errors:', result.errors);
  }
  const title = getDocumentTitle(doc);
  FsmPanel.currentPanel.update(result.fsms, title, doc.uri);
}

function isVhdlDocument(doc: vscode.TextDocument): boolean {
  return (
    doc.languageId === 'vhdl' ||
    doc.fileName.endsWith('.vhd') ||
    doc.fileName.endsWith('.vhdl')
  );
}

function getDocumentTitle(doc: vscode.TextDocument): string {
  const parts = doc.fileName.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || doc.fileName;
}

export function deactivate(): void {
  // Cleanup handled by subscriptions
}
