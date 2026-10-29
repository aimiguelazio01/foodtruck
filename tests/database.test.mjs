import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase,seedCatalog,catalog } from '../lib/database.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('seed is repeatable and catalogs are business scoped',()=>{
 const db=openDatabase(':memory:');
 try { seedCatalog(db); seedCatalog(db); assert.equal(db.prepare('SELECT count(*) AS n FROM products').get().n,30); assert.equal(catalog(db,'urban-burger').products.length,10); assert.equal(catalog(db,'missing'),null); assert.ok(catalog(db,'bella-pizza').products.every(p=>p.id.startsWith('bella-pizza'))); } finally { db.close(); }
});
test('catalog persists across database connections',()=>{
 const dir=mkdtempSync(join(tmpdir(),'foodtruck-test-')); const path=join(dir,'test.sqlite');
 try { let db=openDatabase(path); seedCatalog(db); db.close(); db=openDatabase(path); try {assert.equal(catalog(db,'green-bowl').business.name,'Green Bowl Street Food');} finally {db.close();} } finally {rmSync(dir,{recursive:true,force:true});}
});
