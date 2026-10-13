output "config_path" {
  description = "Where the generated Beacon config was written."
  value       = local_file.config.filename
}

output "config_sha256" {
  description = "SHA-256 of the generated config; compare with `shasum -a 256` of the real file."
  value       = sha256(local_file.config.content)
}

output "deploy_id" {
  description = "Stable deployment id for this environment (random_id, replaced only when the environment changes)."
  value       = random_id.deploy.hex
}
