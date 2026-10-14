# `terraform test` runs these against a throwaway, in-memory state. Every run
# here uses `command = plan`, so nothing is written to out/ and the real
# workspace state is never touched.

variables {
  environment = "dev"
  listen_port = 8080
  app_version = "1.4.0"
  store_kind  = "sqlite"
  store_path  = "/var/lib/beacon/beacon.db"
}

run "renders_dev_config" {
  command = plan

  assert {
    condition     = endswith(local_file.config.filename, "out/dev/beacon.yaml")
    error_message = "config should be written under out/dev/"
  }

  assert {
    condition     = strcontains(local_file.config.content, "port: 8080")
    error_message = "rendered config should carry the listen port"
  }

  assert {
    condition     = strcontains(local_file.config.content, "path: /var/lib/beacon/beacon.db")
    error_message = "sqlite store should render its path"
  }
}

run "memory_store_has_no_path" {
  command = plan

  variables {
    store_kind = "memory"
    store_path = ""
  }

  assert {
    condition     = !strcontains(local_file.config.content, "path:")
    error_message = "memory store must not render a path line"
  }
}

run "rejects_privileged_port" {
  command = plan

  variables {
    listen_port = 80
  }

  expect_failures = [var.listen_port]
}

run "rejects_admin_outside_lab" {
  command = plan

  variables {
    admin_enabled = true
  }

  expect_failures = [var.admin_enabled]
}
