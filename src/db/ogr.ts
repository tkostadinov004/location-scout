import tmp from "tmp";
import fs from "fs";
import { spawn } from "child_process";
import { insert_centroids } from "./postgres-fetch";
import { FeatureCollection, GeometryObject } from "geojson";

export async function insert_data_json_to_db(objects_json: string, table_name: string) {
  await new Promise<void>((resolve, reject) => {
    const tmpFile = tmp.fileSync({ postfix: ".geojson" });
    fs.writeFileSync(tmpFile.name, objects_json);
    const args = [
      `-f`,
      `PostgreSQL`,
      `PG:host=${process.env.PG_HOST} port=${process.env.PG_PORT} user=${process.env.PG_USER} password=${process.env.PG_PASS} dbname=${process.env.PG_DATABASE} schemas=${process.env.PG_SCHEMA}`,
      tmpFile.name,
      `-lco`,
      `SCHEMA=${process.env.PG_SCHEMA}`,
      `-nln`,
      table_name,
    ];
    const child = spawn("ogr2ogr", args);

    child.stderr.on("data", (data) => {
      console.error(`GDAL Error: ${data}`);
    });

    child.on("error", (err) => {
      reject(`Failed to start process: ${err.message}`);
    });

    child.on("close", (code) => {
      if (code === 0) {
        tmpFile.removeCallback();
        resolve();
      } else {
        reject(`Process exited with code ${code}`);
      }
    });
  });

  await insert_centroids(table_name);
}

export async function insert_data_to_db(objects: FeatureCollection<GeometryObject>, table_name: string) {
  await insert_data_json_to_db(JSON.stringify(objects), table_name);
}
