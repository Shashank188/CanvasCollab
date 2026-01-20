import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    // Create tables
    await client.query(`
      -- Canvas table to store canvas metadata
      CREATE TABLE IF NOT EXISTS canvases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL DEFAULT 'Untitled Canvas',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Shapes table to store current state of shapes
      CREATE TABLE IF NOT EXISTS shapes (
        id UUID PRIMARY KEY,
        canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        properties JSONB NOT NULL,
        z_index INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
      );

      -- Events table to store all user events (event sourcing)
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        shape_id UUID,
        user_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        payload JSONB NOT NULL,
        version BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for better query performance
      CREATE INDEX IF NOT EXISTS idx_shapes_canvas_id ON shapes(canvas_id);
      CREATE INDEX IF NOT EXISTS idx_events_canvas_id ON events(canvas_id);
      CREATE INDEX IF NOT EXISTS idx_events_version ON events(canvas_id, version);
      CREATE INDEX IF NOT EXISTS idx_events_shape_id ON events(shape_id);

      -- Create a sequence for versioning events per canvas
      CREATE SEQUENCE IF NOT EXISTS event_version_seq;
    `);

    console.log('Database initialized successfully!');
    
    // Create a default canvas for testing
    const result = await client.query(`
      INSERT INTO canvases (id, name) 
      VALUES ('00000000-0000-0000-0000-000000000001', 'Default Canvas')
      ON CONFLICT (id) DO NOTHING
      RETURNING id;
    `);
    
    if (result.rows.length > 0) {
      console.log('Default canvas created with ID:', result.rows[0].id);
    } else {
      console.log('Default canvas already exists');
    }
    
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase();
