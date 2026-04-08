package data

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/halli75/driftfin/dashboard/internal/model"
)

var (
	reScoreValue     = regexp.MustCompile(`(\d+\.?\d*)`)
	reArchetype      = regexp.MustCompile(`(?i)\*\*Arquetipo(?:\s+detectado)?\*\*\s*\|\s*(.+)`)
	reTlDr           = regexp.MustCompile(`(?i)\*\*TL;DR\*\*\s*\|\s*(.+)`)
	reTlDrColon      = regexp.MustCompile(`(?i)\*\*TL;DR:\*\*\s*(.+)`)
	reRemote         = regexp.MustCompile(`(?i)\*\*Remote\*\*\s*\|\s*(.+)`)
	reComp           = regexp.MustCompile(`(?i)\*\*Comp\*\*\s*\|\s*(.+)`)
	reArchetypeColon = regexp.MustCompile(`(?i)\*\*Arquetipo:\*\*\s*(.+)`)
)

// ParseApplications reads applications.csv and falls back to legacy applications.md.
func ParseApplications(careerOpsPath string) []model.CareerApplication {
	if apps := parseApplicationsCSV(careerOpsPath); len(apps) > 0 {
		enrichFromApplyLog(careerOpsPath, apps)
		return apps
	}

	apps := parseLegacyApplicationsMarkdown(careerOpsPath)
	enrichFromApplyLog(careerOpsPath, apps)
	return apps
}

func parseApplicationsCSV(careerOpsPath string) []model.CareerApplication {
	filePath := filepath.Join(careerOpsPath, "data", "applications.csv")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	reader := csv.NewReader(strings.NewReader(string(content)))
	rows, err := reader.ReadAll()
	if err != nil || len(rows) <= 1 {
		return nil
	}

	headerIndex := make(map[string]int)
	for index, name := range rows[0] {
		headerIndex[name] = index
	}

	get := func(row []string, key string) string {
		index, ok := headerIndex[key]
		if !ok || index >= len(row) {
			return ""
		}
		return row[index]
	}

	apps := make([]model.CareerApplication, 0, len(rows)-1)
	for _, row := range rows[1:] {
		scoreRaw := get(row, "score")
		score := 0.0
		if sm := reScoreValue.FindStringSubmatch(scoreRaw); sm != nil {
			score, _ = strconv.ParseFloat(sm[1], 64)
		}

		date := get(row, "discovered_at")
		if len(date) > 10 {
			date = date[:10]
		}

		number, _ := strconv.Atoi(get(row, "application_id"))
		apps = append(apps, model.CareerApplication{
			Number:           number,
			ApplicationID:    get(row, "application_id"),
			Date:             date,
			Company:          get(row, "company"),
			Role:             get(row, "position"),
			Status:           get(row, "status"),
			Score:            score,
			ScoreRaw:         scoreRaw,
			Grade:            get(row, "grade"),
			HasPDF:           get(row, "custom_resume_path") != "",
			CustomResumePath: get(row, "custom_resume_path"),
			ReportPath:       get(row, "report_path"),
			ReportNumber:     get(row, "report_num"),
			Notes:            get(row, "details"),
			JobURL:           get(row, "url"),
			CredentialID:     get(row, "credential_id"),
		})
	}

	return apps
}

func parseLegacyApplicationsMarkdown(careerOpsPath string) []model.CareerApplication {
	filePath := filepath.Join(careerOpsPath, "data", "applications.md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		filePath = filepath.Join(careerOpsPath, "applications.md")
		content, err = os.ReadFile(filePath)
		if err != nil {
			return nil
		}
	}

	lines := strings.Split(string(content), "\n")
	apps := make([]model.CareerApplication, 0)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "# ") || strings.HasPrefix(line, "|---") || strings.HasPrefix(line, "| #") {
			continue
		}
		if !strings.HasPrefix(line, "|") {
			continue
		}

		fields := strings.Split(strings.Trim(line, "|"), "|")
		if len(fields) < 8 {
			continue
		}
		for index := range fields {
			fields[index] = strings.TrimSpace(fields[index])
		}

		number, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}

		score := 0.0
		if sm := reScoreValue.FindStringSubmatch(fields[4]); sm != nil {
			score, _ = strconv.ParseFloat(sm[1], 64)
		}

		reportNumber := ""
		reportPath := ""
		if match := regexp.MustCompile(`\[(\d+)\]\(([^)]+)\)`).FindStringSubmatch(fields[7]); match != nil {
			reportNumber = match[1]
			reportPath = match[2]
		}

		apps = append(apps, model.CareerApplication{
			Number:       number,
			ApplicationID: fields[0],
			Date:         fields[1],
			Company:      fields[2],
			Role:         fields[3],
			Status:       fields[5],
			Score:        score,
			ScoreRaw:     fields[4],
			HasPDF:       strings.Contains(fields[6], ".pdf"),
			ReportPath:   reportPath,
			ReportNumber: reportNumber,
			Notes:        fieldOr(fields, 8),
		})
	}
	return apps
}

func fieldOr(fields []string, index int) string {
	if index >= len(fields) {
		return ""
	}
	return fields[index]
}

func enrichFromApplyLog(careerOpsPath string, apps []model.CareerApplication) {
	logPath := filepath.Join(careerOpsPath, "data", "apply-log.csv")
	content, err := os.ReadFile(logPath)
	if err != nil {
		return
	}

	reader := csv.NewReader(strings.NewReader(string(content)))
	rows, err := reader.ReadAll()
	if err != nil || len(rows) <= 1 {
		return
	}

	headerIndex := make(map[string]int)
	for index, name := range rows[0] {
		headerIndex[name] = index
	}

	get := func(row []string, key string) string {
		index, ok := headerIndex[key]
		if !ok || index >= len(row) {
			return ""
		}
		return row[index]
	}

	type applyEntry struct {
		ApplicationID    string
		ReportNum        string
		Result           string
		Timestamp        string
		BlockerType      string
		CredentialID     string
		CredentialAction string
		Notes            string
	}

	latestByApp := make(map[string]applyEntry)
	latestByReport := make(map[string]applyEntry)

	for _, row := range rows[1:] {
		entry := applyEntry{
			ApplicationID:    get(row, "application_id"),
			ReportNum:        get(row, "report_num"),
			Result:           get(row, "result"),
			Timestamp:        get(row, "timestamp"),
			BlockerType:      get(row, "blocker_type"),
			CredentialID:     get(row, "credential_id"),
			CredentialAction: get(row, "credential_action"),
			Notes:            get(row, "notes"),
		}

		if entry.ApplicationID != "" {
			prev, ok := latestByApp[entry.ApplicationID]
			if !ok || entry.Timestamp > prev.Timestamp {
				latestByApp[entry.ApplicationID] = entry
			}
		}
		if entry.ReportNum != "" {
			prev, ok := latestByReport[entry.ReportNum]
			if !ok || entry.Timestamp > prev.Timestamp {
				latestByReport[entry.ReportNum] = entry
			}
		}
	}

	for index := range apps {
		entry, ok := latestByApp[apps[index].ApplicationID]
		if !ok {
			entry, ok = latestByReport[apps[index].ReportNumber]
		}
		if !ok {
			continue
		}
		apps[index].ApplyResult = entry.Result
		apps[index].ApplyTime = entry.Timestamp
		apps[index].BlockerType = entry.BlockerType
		apps[index].CredentialID = entry.CredentialID
		apps[index].CredentialAction = entry.CredentialAction
		apps[index].ApplyNotes = entry.Notes
	}
}

// ComputeMetrics calculates aggregate metrics from applications.
func ComputeMetrics(apps []model.CareerApplication) model.PipelineMetrics {
	m := model.PipelineMetrics{
		Total:    len(apps),
		ByStatus: make(map[string]int),
	}

	var totalScore float64
	var scored int
	for _, app := range apps {
		status := NormalizeStatus(app.Status)
		m.ByStatus[status]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > m.TopScore {
				m.TopScore = app.Score
			}
		}
		if app.HasPDF {
			m.WithPDF++
		}
		if status != "skip" && status != "rejected" && status != "closed" && status != "duplicate" {
			m.Actionable++
		}
		switch app.ApplyResult {
		case "submitted", "duplicate_skipped":
			m.Submitted++
		case "blocked":
			m.Blocked++
		case "failed":
			m.FailedApply++
		}
	}

	if scored > 0 {
		m.AvgScore = totalScore / float64(scored)
	}

	return m
}

// NormalizeStatus normalizes raw status text to a canonical form.
func NormalizeStatus(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	switch {
	case strings.Contains(s, "no aplicar") || strings.Contains(s, "no_aplicar") || s == "skip" || strings.Contains(s, "skipped"):
		return "skip"
	case strings.Contains(s, "interview") || strings.Contains(s, "entrevista"):
		return "interview"
	case strings.Contains(s, "offer") || strings.Contains(s, "oferta"):
		return "offer"
	case strings.Contains(s, "respond"):
		return "responded"
	case strings.Contains(s, "applied") || strings.Contains(s, "aplicado"):
		return "applied"
	case strings.Contains(s, "rejected") || strings.Contains(s, "rechazado"):
		return "rejected"
	case strings.Contains(s, "closed") || strings.Contains(s, "discarded") || strings.Contains(s, "descartado"):
		return "closed"
	case strings.Contains(s, "duplicate"):
		return "duplicate"
	case strings.Contains(s, "blocked"):
		return "blocked"
	case strings.Contains(s, "failed"):
		return "failed"
	case strings.Contains(s, "applying"):
		return "applying"
	case strings.Contains(s, "evaluated") || strings.Contains(s, "evaluada"):
		return "evaluated"
	default:
		return s
	}
}

// LoadReportSummary extracts key fields from a report file.
func LoadReportSummary(careerOpsPath, reportPath string) (archetype, tldr, remote, comp string) {
	fullPath := filepath.Join(careerOpsPath, reportPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	text := string(content)

	if m := reArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeColon.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	}
	if m := reTlDr.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDrColon.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	}
	if m := reRemote.FindStringSubmatch(text); m != nil {
		remote = cleanTableCell(m[1])
	}
	if m := reComp.FindStringSubmatch(text); m != nil {
		comp = cleanTableCell(m[1])
	}
	if len(tldr) > 120 {
		tldr = tldr[:117] + "..."
	}
	return
}

// UpdateApplicationStatus updates the status of an application in applications.csv.
func UpdateApplicationStatus(careerOpsPath string, app model.CareerApplication, newStatus string) error {
	filePath := filepath.Join(careerOpsPath, "data", "applications.csv")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	reader := csv.NewReader(strings.NewReader(string(content)))
	rows, err := reader.ReadAll()
	if err != nil || len(rows) == 0 {
		return err
	}

	headerIndex := make(map[string]int)
	for index, name := range rows[0] {
		headerIndex[name] = index
	}

	idIndex, ok := headerIndex["application_id"]
	if !ok {
		return fmt.Errorf("application_id column missing")
	}
	statusIndex, ok := headerIndex["status"]
	if !ok {
		return fmt.Errorf("status column missing")
	}
	updatedIndex := headerIndex["updated_at"]

	found := false
	for rowIndex := 1; rowIndex < len(rows); rowIndex++ {
		if idIndex >= len(rows[rowIndex]) {
			continue
		}
		if rows[rowIndex][idIndex] == app.ApplicationID {
			rows[rowIndex][statusIndex] = newStatus
			if updatedIndex < len(rows[rowIndex]) {
				rows[rowIndex][updatedIndex] = time.Now().UTC().Format(time.RFC3339)
			}
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("application not found: %s", app.ApplicationID)
	}

	var builder strings.Builder
	writer := csv.NewWriter(&builder)
	if err := writer.WriteAll(rows); err != nil {
		return err
	}
	return os.WriteFile(filePath, []byte(builder.String()), 0644)
}

func cleanTableCell(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "|")
	return strings.TrimSpace(s)
}

// StatusPriority returns the sort priority for a status (lower = higher priority).
func StatusPriority(status string) int {
	switch NormalizeStatus(status) {
	case "interview":
		return 0
	case "offer":
		return 1
	case "responded":
		return 2
	case "applied":
		return 3
	case "evaluated":
		return 4
	case "applying":
		return 5
	case "skip":
		return 6
	case "closed":
		return 7
	case "duplicate":
		return 8
	case "rejected":
		return 9
	default:
		return 10
	}
}
