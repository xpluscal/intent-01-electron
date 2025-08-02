import Database from './db.js';

async function initializeDatabase() {
  const db = new Database();
  
  try {
    await db.initialize();
    console.log('Database initialized successfully');
    await db.close();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  initializeDatabase();
}

export default initializeDatabase;