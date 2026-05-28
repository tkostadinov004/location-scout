import { Pool } from "pg";
import format from "pg-format";
import { RentableObject } from "../response/RentableObject";
import { ScoreCalculationCommonData } from "../response/ScoreCalculationCommonData";
import { AdditionalCriterion } from "../input/AdditionalCriterion";

export async function get_common_data(): Promise<ScoreCalculationCommonData> {
  const min_max_rents: number[] = await get_min_max_rents();
  const sofia_population: number = await get_sofia_population();
  return new ScoreCalculationCommonData(sofia_population, min_max_rents[0], min_max_rents[1]);
}

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
    options: `-c search_path=${process.env.PG_SCHEMA},public`,
    // ssl: true,
  });
};

async function get_sofia_population(): Promise<number> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(`select sum(ppl_sgr_30) as sum from population_per_building;`);
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
          select min(rent_per_m2_eur) as min_rent, max(rent_per_m2_eur) as max_rent 
          from rentable_properties 
          where rent_per_m2_eur is not null;
      `);
    return [Number.parseFloat(res.rows[0].min_rent ?? "0"), Number.parseFloat(res.rows[0].max_rent ?? "0")];
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function insert_centroids(table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const query_string = format(
      `
        alter table %I
        drop column if exists wkb_geometry_centroid,
        add column wkb_geometry_centroid geometry;
        update %I set wkb_geometry_centroid = st_centroid(wkb_geometry);
        `,
      table_name.replaceAll("-", "_"),
      table_name.replaceAll("-", "_")
    );
    await conn.query(query_string);
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function remove_temp_table(table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    await conn.query(format(`drop table %I;`, [table_name.replaceAll("-", "_")]));
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function get_osm_data(query: string): Promise<string | null> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(
      format(
        `
        select result
        from osm_queries
        where lower(query) = lower(%L);
        `,
        query
      )
    );
    const res_str: string[] = res.rows.map((r) => r.result);
    return res_str.length == 0 ? null : res_str[0];
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function insert_osm_query_record(query: string, data_table_name: string) {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    await conn.query(
      format(
        `
        insert into osm_queries (query, result) values (%L, table_to_geojson(%L));
        `,
        query,
        data_table_name.replaceAll("-", "_")
      )
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function check_if_osm_data_exists(query: string): Promise<boolean> {
  const pool: Pool = get_pg_pool();
  let conn;
  try {
    conn = await pool.connect();
    const res = await conn.query(
      format(
        `
        select exists(select id 
        from osm_queries
        where query = %L);
        `,
        query
      )
    );
    return res.rows[0].exists;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function get_rentable_objects(objects_of_same_type_table_name: string, additional_criteria: AdditionalCriterion[]): Promise<RentableObject[]> {
  objects_of_same_type_table_name = objects_of_same_type_table_name.replaceAll("-", "_");
  let query_string = format(
    `
    select st_asgeojson(rp.wkb_geometry) as point, st_asgeojson(isochrone) as isochrone, st_area(isochrone::geography) as isochrone_area,
                name, url, address, rent_eur, rent_bgn, area,
                approximate_customer_count, rent_per_m2_eur, rent_per_m2_bgn, shortest_dist_to_park,
                shortest_dist_to_public_transport, shortest_dist_to_school, 
                st_asgeojson(st_collect(distinct st_centroid(same_objects_t.wkb_geometry))) as same_objects,
                count(distinct same_objects_t.wkb_geometry) as count_same
                ${additional_criteria.find((p) => p.type == "park") ? ", st_asgeojson(get_parks_centroids_in_area(isochrone)) as parks" : ""}
                ${additional_criteria.find((p) => p.type == "school") ? ", st_asgeojson(get_schools_centroids_in_area(isochrone)) as schools" : ""}
                ${additional_criteria.find((p) => p.type == "public_transport") ? ", st_asgeojson(get_public_transport_centroids_stops_in_area(isochrone)) as public_transport_stops" : ""}
            from rentable_properties rp left join %I as same_objects_t on st_within(same_objects_t.wkb_geometry, isochrone)
            group by rp.ogc_fid;
    `,
    objects_of_same_type_table_name
  );

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
          shortest_dist_to_public_transport: r.shortest_dist_to_public_transport,
          shortest_dist_to_school: r.shortest_dist_to_school,
          objects_of_same_type_in_isochrone: r.same_objects,
          objects_of_same_type_in_isochrone_count: r.count_same,
          parks_in_isochrone: r.parks ? r.parks : null,
          schools_in_isochrone: r.schools ? r.schools : null,
          public_transport_stops_in_isochrone: r.public_transport_stops ? r.public_transport_stops : null,
        })
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function get_rentable_objects_with_additional_pois(
  objects_of_same_type_table_name: string,
  additional_pois_table_name: string,
  additional_pois_fetch_type: boolean,
  additional_criteria: AdditionalCriterion[]
): Promise<RentableObject[]> {
  objects_of_same_type_table_name = objects_of_same_type_table_name.replaceAll("-", "_");
  additional_pois_table_name = additional_pois_table_name.replaceAll("-", "_");

  const query_string = format(
    `
    with additional_pois as (
      select ap.wkb_geometry, row_number() over (partition by ap.id order by pnnvp.the_geom <-> ap.wkb_geometry_centroid) as rn, pnnvp.id as vertex_id
      from %I ap
      left join pedestrian_network_noded_vertices_pgr pnnvp on st_within(pnnvp.the_geom, st_buffer(ap.wkb_geometry::geography, 200)::geometry)
      group by ap.ogc_fid, pnnvp.id, pnnvp.the_geom
    ), rp as (
      select rentable_properties.*, array_remove(array_agg(ap.vertex_id), null) as additional_poi_vertices_in_isochrone, 
        st_collect(ap.wkb_geometry) as additional_pois_in_isochrone   
      from rentable_properties
      left join additional_pois ap on st_within(ap.wkb_geometry, isochrone)
      where ap.rn is null or ap.rn = 1
      group by rentable_properties.ogc_fid
    ), same_objects_t as (
      select rp.ogc_fid, st_collect(distinct st_centroid(so.wkb_geometry)) as same_objects, count(distinct so.wkb_geometry) as count_same
      from rp
      left join %I as so on st_within(so.wkb_geometry, isochrone)
      group by rp.ogc_fid
    )
    select st_asgeojson(rp.wkb_geometry) as point, st_asgeojson(isochrone) as isochrone, st_area(isochrone::geography) as isochrone_area,
                name, url, address, rent_eur, rent_bgn, area,
                approximate_customer_count, rent_per_m2_eur, rent_per_m2_bgn, shortest_dist_to_park,
                shortest_dist_to_public_transport, shortest_dist_to_school, 
                st_asgeojson(same_objects) as same_objects,
                count_same
                ${additional_criteria.find((p) => p.type == "park") ? ", st_asgeojson(get_parks_centroids_in_area(isochrone)) as parks" : ""}
                ${additional_criteria.find((p) => p.type == "school") ? ", st_asgeojson(get_schools_centroids_in_area(isochrone)) as schools" : ""}
                ${additional_criteria.find((p) => p.type == "public_transport") ? ", st_asgeojson(get_public_transport_centroids_stops_in_area(isochrone)) as public_transport_stops" : ""},    
                st_asgeojson(additional_pois_in_isochrone) as additional_pois_in_isochrone, 
                ${
                  additional_pois_fetch_type
                    ? `st_distance(rp.wkb_geometry::geography, (select ap.wkb_geometry from additional_pois ap order by ap.wkb_geometry <-> rp.wkb_geometry limit 1)::geography) / 1000`
                    : `(case when cardinality(additional_poi_vertices_in_isochrone) > 0 then (select min(agg_cost) / 1000 from pgr_dijkstraCost('SELECT id, source, target, meters as cost FROM pedestrian_network_noded', rp.closest_vertex, rp.additional_poi_vertices_in_isochrone, false)) else null end)`
                } as min_distance_to_additional_poi 
            from rp
            left join same_objects_t on same_objects_t.ogc_fid = rp.ogc_fid;
`,
    additional_pois_table_name,
    objects_of_same_type_table_name
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
          shortest_dist_to_public_transport: r.shortest_dist_to_public_transport,
          shortest_dist_to_school: r.shortest_dist_to_school,
          objects_of_same_type_in_isochrone: r.same_objects,
          objects_of_same_type_in_isochrone_count: r.count_same,
          parks_in_isochrone: r.parks ? r.parks : null,
          schools_in_isochrone: r.schools ? r.schools : null,
          public_transport_stops_in_isochrone: r.public_transport_stops ? r.public_transport_stops : null,
          additional_pois: r.additional_pois_in_isochrone,
          min_distance_to_additional_poi: r.min_distance_to_additional_poi,
        })
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}
