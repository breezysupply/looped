-- Beacon schema 2 (expand, backwards compatible): an index; schema-1 code keeps working
CREATE INDEX records_sensor_ts ON records (sensor_id, ts);
