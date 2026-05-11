import { FeatureCollection, GeometryObject } from "geojson";
import { ogr2ogr } from "ogr2ogr";
import { Pool } from "pg";
import tmp from "tmp";
import fs from "fs";
import { spawn } from "child_process";
import format from "pg-format";
import { table } from "console";
import { AdditionalCriterion } from "../services/score_calculator";

const get_pg_pool = function () {
  return new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASS,
    port: Number.parseInt(process.env.PG_PORT ?? ""),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: true,
  });
};

async function get_sofia_population(): Promise<number> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(`
          select sum(ppl_sgr_30) as sum from teodorsk_work.population_per_building;
      `);
    return res.rows[0].sum;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

async function get_min_max_rents(): Promise<number[]> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(`
          select min(rent_per_m2_eur) as min_rent, max(rent_per_m2_eur) as max_rent from rentable_properties where rent_per_m2_eur is not null;
      `);
    return [
      Number.parseFloat(res.rows[0].min_rent ?? "0"),
      Number.parseFloat(res.rows[0].max_rent ?? "0"),
    ];
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

/*

{
      type: "FeatureCollection",
      features: res.rows.map((row) => ({
        type: "Feature",
        geometry: JSON.parse(row.point),
        properties: {
          isochrone: row.isochrone ? JSON.parse(row.isochrone) : "Unknown",
          name: row.name || "Unknown",
          url: row.url || "Unknown",
          rent_eur: row.rent_eur || "Unknown",
          rent_bgn: row.rent_bgn || "Unknown",
          area: row.area || "Unknown",
        },
      })),
    }
*/

async function normalize_geometries(table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    await conn.query(
      format(
        `
        update %I
        set wkb_geometry = st_centroid(wkb_geometry)
        where st_geometrytype(wkb_geometry) <> 'ST_Point';
        `,
        table_name,
      ),
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function insert_data_to_db(
  objects: FeatureCollection<GeometryObject>,
  table_name: string,
) {
  await new Promise<void>((resolve, reject) => {
    const tmpFile = tmp.fileSync({ postfix: ".geojson" });
    fs.writeFileSync(tmpFile.name, JSON.stringify(objects));
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

  const real_table_name = table_name.replaceAll("-", "_");
  await normalize_geometries(real_table_name);
}

export async function remove_temp_table(table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    await conn.query(
      format(`drop table %I;`, [table_name.replaceAll("-", "_")]),
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export class RentableObject {
  point: string = "";
  isochrone: string = "";
  isochrone_area: number = 0;
  name: string = "";
  url: string = "";
  address: string = "";
  rent_eur: string | number = 0;
  rent_bgn: string | number = 0;
  area: number = 0;
  approximate_customer_count: number = 0;
  rent_per_m2_eur: number | null = null;
  rent_per_m2_bgn: number | null = null;
  shortest_dist_to_park: number | null = null;
  shortest_dist_to_public_transport: number | null = null;
  shortest_dist_to_school: number | null = null;

  objects_of_same_type_in_isochrone: string = "";
  objects_of_same_type_in_isochrone_count: number = 0;
  base_score: number | null = null;
  total_score: number | null = null;

  parks_in_isochrone: string | null = null;
  public_transport_stops_in_isochrone: string | null = null;
  schools_in_isochrone: string | null = null;

  additional_pois: string | null = null;
  min_distance_to_additional_poi: number | null = null;

  constructor(init?: Partial<RentableObject>) {
    if (init) {
      Object.assign(this, init);
    }
  }
}

export class ScoreCalculationCommonData {
  total_sofia_population: number;
  max_rent: number;
  min_rent: number;

  constructor(tsp: number, max_rent: number, min_rent: number) {
    this.total_sofia_population = tsp;
    this.max_rent = max_rent;
    this.min_rent = min_rent;
  }
}

export async function get_common_data(): Promise<ScoreCalculationCommonData> {
  const min_max_rents: number[] = await get_min_max_rents();
  const sofia_population: number = await get_sofia_population();
  return new ScoreCalculationCommonData(
    sofia_population,
    min_max_rents[0],
    min_max_rents[1],
  );
}

export async function get_rentable_objects(
  objects_of_same_type_table_name: string,
  additional_pois_table_name: string | null,
  additional_pois_fetch_type: boolean,
  additional_criteria: AdditionalCriterion[],
): Promise<RentableObject[]> {
  objects_of_same_type_table_name = objects_of_same_type_table_name.replaceAll(
    "-",
    "_",
  );
  if (additional_pois_table_name) {
    additional_pois_table_name = additional_pois_table_name.replaceAll(
      "-",
      "_",
    );
  }
  let query_string = format(
    `select st_asgeojson(rp.wkb_geometry) as point, st_asgeojson(isochrone) as isochrone, st_area(isochrone::geography) as isochrone_area,
                name, url, address, rent_eur, rent_bgn, area,
                approximate_customer_count, rent_per_m2_eur, rent_per_m2_bgn, shortest_dist_to_park,
                shortest_dist_to_public_transport, shortest_dist_to_school, 
                st_asgeojson((select st_collect(s.wkb_geometry) from %I s where st_contains(isochrone, s.wkb_geometry))) as same_objects,
                (select count(s.ogc_fid) from %I s where st_contains(isochrone, s.wkb_geometry)) as count_same
                ${additional_criteria.find((p) => p.type == "park") ? ", st_asgeojson(get_parks_centroids_in_area(isochrone)) as parks" : ""}
                ${additional_criteria.find((p) => p.type == "school") ? ", st_asgeojson(get_schools_centroids_in_area(isochrone)) as schools" : ""}
                ${additional_criteria.find((p) => p.type == "public_transport") ? ", st_asgeojson(get_public_transport_centroids_stops_in_area(isochrone)) as public_transport_stops" : ""}
                ${
                  additional_pois_table_name
                    ? ", st_asgeojson(st_collect(ap.wkb_geometry)) as additional_pois, " +
                      "(select min(agg_cost) / 1000 from (select * from  pgr_dijkstraCost('SELECT id, source, target, meters as cost FROM pedestrian_network_noded', rp.closest_vertex, array_agg(pnnvp.id) filter (where pnnvp.id is not null), false))) as min_distance_to_additional_poi"
                    : ""
                }
            from teodorsk_work.rentable_properties rp
            ${additional_pois_table_name ? "left join %I as ap on st_within(ap.wkb_geometry, isochrone) left join pedestrian_network_noded_vertices_pgr pnnvp on st_within(pnnvp.the_geom, st_buffer(ap.wkb_geometry::geography, 10)::geometry)" : ""}
            group by rp.wkb_geometry, rp.isochrone,  name, url, address, rent_eur, rent_bgn, area,
                approximate_customer_count, rent_per_m2_eur, rent_per_m2_bgn, shortest_dist_to_park,
                shortest_dist_to_public_transport, shortest_dist_to_school, closest_vertex`,
    objects_of_same_type_table_name,
    objects_of_same_type_table_name,
    additional_pois_table_name,
  );

  console.log(query_string);

  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(query_string);
    return res.rows.map(
      (r) =>
        new RentableObject({
          point: r.point,
          isochrone: r.isochrone,
          isochrone_area: r.isochrone_area,
          name: r.name,
          url: r.url,
          address: r.address,
          rent_eur: r.rent_eur,
          rent_bgn: r.rent_bgn,
          area: r.area,
          approximate_customer_count: r.approximate_customer_count,
          rent_per_m2_eur: r.rent_per_m2_eur,
          rent_per_m2_bgn: r.rent_per_m2_bgn,
          shortest_dist_to_park: r.shortest_dist_to_park,
          shortest_dist_to_public_transport:
            r.shortest_dist_to_public_transport,
          shortest_dist_to_school: r.shortest_dist_to_school,
          objects_of_same_type_in_isochrone: r.same_objects,
          objects_of_same_type_in_isochrone_count: r.count_same,
          parks_in_isochrone: r.parks ? r.parks : null,
          schools_in_isochrone: r.schools ? r.schools : null,
          public_transport_stops_in_isochrone: r.public_transport_stops
            ? r.public_transport_stops
            : null,
          additional_pois: r.additional_pois,
          min_distance_to_additional_poi: r.min_distance_to_additional_poi,
        }),
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}
