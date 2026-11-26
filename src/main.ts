import './style.css';
import { Editor } from './editor';
import { View } from './scene';
import { initUI } from './ui';

const view = new View(document.getElementById('viewport')!);
const editor = new Editor(view);
initUI(editor);
