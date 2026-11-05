package cloudflare

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

func (c *Client) ExportMediaFromJournal(ctx context.Context, directory, account, token string) (map[string][]byte, error) {
	files := map[string][]byte{}
	_, err := withJournal(directory, account, false, func(state ProvisionState, _ func(ProvisionState) error) (ProvisionState, error) {
		if len(token) < 32 {
			return state, errors.New("media backup credential unavailable")
		}
		tags, exists, e := c.workerTags(ctx, account, state.Name+"-management")
		if e != nil {
			return state, e
		}
		if !exists || state.Workers["management"] == "" || !slices.Contains(tags, state.Workers["management"]) {
			return state, errors.New("media backup ownership not verified")
		}
		var domain struct {
			Subdomain string `json:"subdomain"`
		}
		if _, e = c.request(ctx, http.MethodGet, "/accounts/"+account+"/workers/subdomain", nil, &domain); e != nil {
			return state, e
		}
		if !subdomainPattern.MatchString(domain.Subdomain) {
			return state, errors.New("invalid media backup origin")
		}
		base := "https://" + state.Name + "-management." + domain.Subdomain + ".workers.dev/api/v1/platform-backup/media"
		fetch := func(query url.Values) (*http.Response, error) {
			request, e := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+query.Encode(), nil)
			if e != nil {
				return nil, e
			}
			request.Header.Set("x-foodtruck-backup", token)
			response, e := c.http.Do(request)
			if e != nil {
				return nil, errors.New("media backup request failed")
			}
			if response.StatusCode != 200 {
				response.Body.Close()
				return nil, errors.New("media backup unavailable; verify package version and authorization")
			}
			return response, nil
		}
		cursor := ""
		seen := map[string]bool{}
		total := 0
		for page := 0; page < 100; page++ {
			response, e := fetch(url.Values{"cursor": {cursor}})
			if e != nil {
				return state, e
			}
			var list struct {
				Objects []struct {
					Key  string `json:"key"`
					Size int    `json:"size"`
					ETag string `json:"etag"`
				} `json:"objects"`
				Cursor *string `json:"cursor"`
			}
			e = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&list)
			response.Body.Close()
			if e != nil || list.Objects == nil || len(list.Objects) > 100 {
				return state, errors.New("invalid media manifest")
			}
			for _, object := range list.Objects {
				if !strings.HasPrefix(object.Key, "uploads/") || strings.Contains(object.Key, "..") || !modulePath.MatchString(object.Key) || object.Size < 0 || object.Size > 8<<20 || len(files) >= 1000 {
					return state, errors.New("unsupported media object or pilot limit")
				}
				if _, duplicate := files[object.Key]; duplicate {
					return state, errors.New("duplicate image in backup")
				}
				total += object.Size
				if total > 32<<20 {
					return state, errors.New("media backup exceeds 32 MiB pilot limit")
				}
				image, e := fetch(url.Values{"key": {object.Key}, "etag": {object.ETag}})
				if e != nil {
					return state, e
				}
				data, e := io.ReadAll(io.LimitReader(image.Body, (8<<20)+1))
				image.Body.Close()
				if e != nil || len(data) != object.Size || image.Header.Get("X-Backup-Etag") != object.ETag {
					return state, errors.New("image changed or truncated during backup")
				}
				files[object.Key] = data
			}
			if list.Cursor == nil {
				return state, nil
			}
			if *list.Cursor == "" || seen[*list.Cursor] {
				return state, errors.New("invalid media pagination")
			}
			cursor = *list.Cursor
			seen[cursor] = true
		}
		return state, errors.New("media pagination limit exceeded")
	})
	return files, err
}
