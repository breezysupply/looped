{{/* Name of the chart, truncated to the DNS label limit. */}}
{{- define "beacon.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Full name: the release name when it already contains the chart name ("beacon"). */}}
{{- define "beacon.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Labels the selector uses. Never change these on an existing release: selectors are immutable. */}}
{{- define "beacon.selectorLabels" -}}
app.kubernetes.io/name: {{ include "beacon.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Labels on every object. */}}
{{- define "beacon.labels" -}}
{{ include "beacon.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
looped.lab/environment: {{ .Values.config.environment }}
{{- range $k, $v := .Values.commonLabels }}
{{ $k }}: {{ $v | quote }}
{{- end }}
{{- end -}}

{{/* Image reference: a digest, when given, wins over the tag (immutable promotion). */}}
{{- define "beacon.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}
{{- end -}}
