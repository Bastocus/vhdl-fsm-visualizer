import * as fs from 'fs';
import * as path from 'path';
import { VhdlFsmParser } from '../src/parser';

const fixturePath = process.argv[2];
if (!fixturePath) { console.error('Usage: run_parser.ts <fixture.vhd>'); process.exit(1); }

const source = fs.readFileSync(fixturePath, 'utf-8');
const result = new VhdlFsmParser().parse(source);
console.log(JSON.stringify({ fsms: result.fsms, title: path.basename(fixturePath) }));
