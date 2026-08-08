-- Reference data. Trust scores are yours to maintain; start conservative.
insert into public.merchants (slug, name, trust_score, knot_supported, return_window_days) values
  ('amazon','Amazon',0.94,true,30), ('bestbuy','Best Buy',0.91,true,15),
  ('costco','Costco',0.95,true,90), ('woot','Woot',0.72,false,14),
  ('netflix','Netflix',0.97,true,null), ('equinox','Equinox',0.96,true,null),
  ('adobe','Adobe',0.96,true,14), ('spotify','Spotify',0.97,true,null),
  ('doordash','DoorDash',0.93,true,null), ('ana','ANA',0.93,false,null)
on conflict (slug) do nothing;
