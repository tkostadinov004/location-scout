export class RentableObject {
  point: string = "";
  isochrone: string = "";
  isochrone_area: number = 0;
  name: string = "";
  url: string = "";
  address: string = "";
  rent_eur: string | null = null;
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
