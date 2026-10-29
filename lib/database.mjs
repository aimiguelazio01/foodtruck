import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function openDatabase(path = process.env.DATABASE_PATH || 'data/foodtruck.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, color TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>=0), available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)), UNIQUE(business_id,id));
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES(1);`);
  return db;
}
export function seedCatalog(db) {
  const brands = [
    ['urban-burger','Urban Burger Truck','#ed8735',['Classic Smash Burger','Double Cheese Burger','BBQ Bacon Burger','Crispy Chicken Burger','Veggie Burger','Loaded Fries','Sweet Potato Fries','Chocolate Brownie','Lemonade','Craft Cola']],
    ['bella-pizza','Bella Pizza Mobile','#ad3434',['Margherita','Pepperoni','Four Cheese','Prosciutto','Vegetarian','Spicy Diavola','Garlic Bread','Tiramisu','Sparkling Water','Homemade Iced Tea']],
    ['green-bowl','Green Bowl Street Food','#46724f',['Chicken Power Bowl','Mediterranean Bowl','Vegan Protein Bowl','Falafel Wrap','Avocado Wrap','Quinoa Salad','Fresh Fruit Cup','Mango Smoothie','Green Smoothie','Homemade Lemonade']]
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [slug,name,color,products] of brands) {
      db.prepare('INSERT OR IGNORE INTO businesses VALUES(?,?,?,?)').run(slug,slug,name,color);
      products.forEach((name,i)=>db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?)').run(`${slug}-${i}`,slug,name,i<5?850+i*100:250+(i-5)*50,1));
    }
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
export function catalog(db,slug) {
  const business=db.prepare('SELECT * FROM businesses WHERE slug=?').get(slug);
  if(!business) return null;
  return {business,products:db.prepare('SELECT id,name,price_cents,available FROM products WHERE business_id=? ORDER BY rowid').all(business.id)};
}
