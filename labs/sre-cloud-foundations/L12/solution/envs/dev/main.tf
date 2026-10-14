module "beacon" {
  source = "../../modules/beacon"

  env                 = var.env
  api_port            = var.api_port
  image               = var.image
  beacon_src          = abspath("${path.root}/../../../../beacon")
  extra_volume_labels = var.extra_volume_labels
}
