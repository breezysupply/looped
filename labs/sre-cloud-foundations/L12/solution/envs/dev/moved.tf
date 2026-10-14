# The objects already exist and are recorded in dev's state at the old
# addresses. Without these blocks the plan would DESTROY them and create new
# ones under module.beacon (and the data volume with them).
moved {
  from = docker_network.beacon
  to   = module.beacon.docker_network.beacon
}

moved {
  from = docker_volume.data
  to   = module.beacon.docker_volume.data
}

moved {
  from = docker_image.python
  to   = module.beacon.docker_image.python
}

moved {
  from = docker_container.api
  to   = module.beacon.docker_container.api
}
