package gws

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// --- Raw gws Chat/People API shapes (only the fields we read) ---
type chatSpace struct {
	Name           string `json:"name"`
	DisplayName    string `json:"displayName"`
	SpaceType      string `json:"spaceType"`
	SpaceURI       string `json:"spaceUri"`
	LastActiveTime string `json:"lastActiveTime"`
}
type spacesResp struct {
	Spaces        []chatSpace `json:"spaces"`
	NextPageToken string      `json:"nextPageToken"`
}
type readState struct {
	Name         string `json:"name"`
	LastReadTime string `json:"lastReadTime"`
}
type chatUser struct {
	Name string `json:"name"` // NOTE: Chat's sender/member has NO displayName
	Type string `json:"type"`
}
type chatMessage struct {
	Name       string    `json:"name"`
	Text       string    `json:"text"`
	CreateTime string    `json:"createTime"`
	Sender     *chatUser `json:"sender"`
}
type messagesResp struct {
	Messages []chatMessage `json:"messages"`
}
type person struct {
	Names []struct {
		DisplayName string `json:"displayName"`
	} `json:"names"`
	Photos []struct {
		URL     string `json:"url"`
		Default bool   `json:"default"`
	} `json:"photos"`
}
type batchGetResp struct {
	Responses []struct {
		RequestedResourceName string  `json:"requestedResourceName"`
		Person                *person `json:"person"`
	} `json:"responses"`
}

// ChatDm mirrors the TS ChatDm payload shape.
type ChatDm struct {
	SpaceID   string `json:"spaceId"`
	Partner   string `json:"partner"`   // People-API-resolved name (fallback "Direct message")
	AvatarURL string `json:"avatarUrl"` // "" when missing or a default silhouette
	Snippet   string `json:"snippet"`
	Time      string `json:"time"`
	URL       string `json:"url"`
}
type ChatDmsData struct {
	Dms    []ChatDm `json:"dms"`
	Errors []string `json:"errors,omitempty"`
}

// ChatChannel mirrors the TS ChatChannel payload shape.
type ChatChannel struct {
	SpaceID string `json:"spaceId"`
	Name    string `json:"name"`
	Snippet string `json:"snippet"`
	Time    string `json:"time"`
	Unread  bool   `json:"unread"`
	URL     string `json:"url"`
}
type ChatChannelsData struct {
	Channels []ChatChannel `json:"channels"`
	Errors   []string      `json:"errors,omitempty"`
}

type chatDmsConfig struct {
	Limit int `json:"limit"`
}
type chatChannelsConfig struct {
	SpaceIDs []string `json:"spaceIds"`
}

// isUnread: a space is unread when its last message is newer than the
// caller's last read time.
func isUnread(lastActiveTime, lastReadTime string) bool {
	if lastActiveTime == "" {
		return false // no messages yet
	}
	if lastReadTime == "" {
		return true // never read
	}
	active, errA := time.Parse(time.RFC3339Nano, lastActiveTime)
	read, errR := time.Parse(time.RFC3339Nano, lastReadTime)
	if errA != nil || errR != nil {
		return false
	}
	return active.After(read)
}

// parseLastActive parses an RFC3339Nano timestamp for chronological sorting.
// Unparsable (including empty) values sort as the zero time.
func parseLastActive(t string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, t)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

var callerRe = regexp.MustCompile(`^(users/[^/]+)/`)

// "users/12345/spaces/AAAA/spaceReadState" → "users/12345" (or "").
func callerUserID(readStateName string) string {
	m := callerRe.FindStringSubmatch(readStateName)
	if m == nil {
		return ""
	}
	return m[1]
}

// Chat sender id "users/12345" → People API resource "people/12345" (or "").
func peopleResourceName(userName string) string {
	if id, ok := strings.CutPrefix(userName, "users/"); ok && id != "" {
		return "people/" + id
	}
	return ""
}

type partner struct {
	name, photo string
}

func personToPartner(p *person) partner {
	out := partner{}
	if p == nil {
		return out
	}
	if len(p.Names) > 0 {
		out.name = p.Names[0].DisplayName
	}
	// Skip Google's generic silhouette (`default: true`) so the widget falls
	// back to initials.
	for _, photo := range p.Photos {
		if photo.URL != "" && !photo.Default {
			out.photo = photo.URL
			break
		}
	}
	return out
}

// resolvePartners resolves many Chat sender ids to display names + avatars in
// ONE People getBatchGet call instead of one people.get per DM. A whole-call
// failure or a missing person falls back to the zero partner, so normalizeDm
// degrades to "Direct message".
func resolvePartners(ctx context.Context, run jsonRunner, senderNames []string) map[string]partner {
	out := map[string]partner{}
	type pair struct{ sender, resource string }
	pairs := []pair{}
	seen := map[string]bool{}
	resources := []string{}
	for _, sender := range senderNames {
		resource := peopleResourceName(sender)
		if sender == "" || resource == "" {
			continue
		}
		pairs = append(pairs, pair{sender, resource})
		if !seen[resource] {
			seen[resource] = true
			resources = append(resources, resource)
		}
	}
	if len(resources) == 0 {
		return out
	}
	byResource := map[string]partner{}
	var resp batchGetResp
	if err := run(ctx, []string{
		"people", "people", "getBatchGet",
		"--params", jsonArg(map[string]any{"resourceNames": resources, "personFields": "names,photos"}),
	}, &resp); err == nil {
		for _, r := range resp.Responses {
			if r.RequestedResourceName != "" {
				byResource[r.RequestedResourceName] = personToPartner(r.Person)
			}
		}
	}
	for _, p := range pairs {
		out[p.sender] = byResource[p.resource]
	}
	return out
}

func normalizeDm(space chatSpace, msg chatMessage, p partner) ChatDm {
	name := strings.TrimSpace(p.name)
	if name == "" {
		name = "Direct message"
	}
	t := msg.CreateTime
	if t == "" {
		t = space.LastActiveTime
	}
	return ChatDm{
		SpaceID: space.Name, Partner: name, AvatarURL: p.photo,
		Snippet: strings.TrimSpace(msg.Text), Time: t, URL: space.SpaceURI,
	}
}

func normalizeChannel(spaceID string, space chatSpace, rs readState, msg *chatMessage) ChatChannel {
	name := strings.TrimSpace(space.DisplayName)
	if name == "" {
		name = spaceID
	}
	out := ChatChannel{
		SpaceID: spaceID, Name: name,
		Unread: isUnread(space.LastActiveTime, rs.LastReadTime),
		URL:    space.SpaceURI, Time: space.LastActiveTime,
	}
	if msg != nil {
		out.Snippet = strings.TrimSpace(msg.Text)
		if msg.CreateTime != "" {
			out.Time = msg.CreateTime
		}
	}
	return out
}

func fetchChatDms(ctx context.Context, run jsonRunner, cfg chatDmsConfig) (ChatDmsData, error) {
	var list spacesResp
	if err := run(ctx, []string{
		"chat", "spaces", "list",
		"--params", jsonArg(map[string]any{"filter": `spaceType = "DIRECT_MESSAGE"`, "pageSize": 1000}),
	}, &list); err != nil {
		return ChatDmsData{}, err
	}
	dmSpaces := []chatSpace{}
	for _, s := range list.Spaces {
		if s.LastActiveTime != "" {
			dmSpaces = append(dmSpaces, s)
		}
	}
	sort.SliceStable(dmSpaces, func(i, j int) bool {
		return parseLastActive(dmSpaces[i].LastActiveTime).After(parseLastActive(dmSpaces[j].LastActiveTime))
	})
	if len(dmSpaces) > cfg.Limit {
		dmSpaces = dmSpaces[:cfg.Limit]
	}

	// Read state per candidate (light). One failure shouldn't sink the widget.
	type stated struct {
		space chatSpace
		rs    readState
		ok    bool
	}
	states := make([]stated, len(dmSpaces))
	var wg sync.WaitGroup
	for i, space := range dmSpaces {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var rs readState
			err := run(ctx, []string{
				"chat", "users", "spaces", "getSpaceReadState",
				"--params", jsonArg(map[string]any{"name": "users/me/" + space.Name + "/spaceReadState"}),
			}, &rs)
			states[i] = stated{space: space, rs: rs, ok: err == nil}
		}()
	}
	wg.Wait()

	type unreadDm struct {
		space chatSpace
		me    string
	}
	unread := []unreadDm{}
	for _, s := range states {
		if s.ok && isUnread(s.space.LastActiveTime, s.rs.LastReadTime) {
			unread = append(unread, unreadDm{space: s.space, me: callerUserID(s.rs.Name)})
		}
	}

	// For each unread DM: fetch the latest message (snippet/time/partner id).
	// Partner-name resolution is deferred and batched below — one People call
	// for all DMs instead of one per DM (N+1 → 1).
	type enrichedDm struct {
		space chatSpace
		msg   chatMessage
		skip  bool
	}
	enrichedSlots := make([]enrichedDm, len(unread))
	msgErrs := make([]error, len(unread))
	for i, u := range unread {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var resp messagesResp
			err := run(ctx, []string{
				"chat", "spaces", "messages", "list",
				"--params", jsonArg(map[string]any{"parent": u.space.Name, "orderBy": "createTime desc", "pageSize": 1}),
			}, &resp)
			if err != nil {
				msgErrs[i] = err
				return
			}
			if len(resp.Messages) == 0 {
				enrichedSlots[i] = enrichedDm{skip: true}
				return
			}
			msg := resp.Messages[0]
			// Self-sent — best-effort (skipped if read-state name lacked a user id).
			if u.me != "" && msg.Sender != nil && msg.Sender.Name == u.me {
				enrichedSlots[i] = enrichedDm{skip: true}
				return
			}
			enrichedSlots[i] = enrichedDm{space: u.space, msg: msg}
		}()
	}
	wg.Wait()

	enriched := []enrichedDm{}
	errors := []string{}
	for i := range unread {
		if msgErrs[i] != nil {
			// Couldn't load this DM's latest message — surface, don't drop silently.
			errors = append(errors, unread[i].space.Name)
			continue
		}
		if !enrichedSlots[i].skip {
			enriched = append(enriched, enrichedSlots[i])
		}
	}

	senders := make([]string, 0, len(enriched))
	for _, e := range enriched {
		if e.msg.Sender != nil {
			senders = append(senders, e.msg.Sender.Name)
		} else {
			senders = append(senders, "")
		}
	}
	partners := resolvePartners(ctx, run, senders)
	dms := []ChatDm{}
	for i, e := range enriched {
		dms = append(dms, normalizeDm(e.space, e.msg, partners[senders[i]]))
	}

	if len(errors) > 0 {
		return ChatDmsData{Dms: dms, Errors: errors}, nil
	}
	return ChatDmsData{Dms: dms}, nil
}

func fetchChatChannels(ctx context.Context, run jsonRunner, cfg chatChannelsConfig) (ChatChannelsData, error) {
	type result struct {
		channel ChatChannel
		err     error
	}
	results := make([]result, len(cfg.SpaceIDs))
	var wg sync.WaitGroup
	for i, spaceID := range cfg.SpaceIDs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Any one of these failing (e.g. a stale/404 id) drops just this space.
			var space chatSpace
			var rs readState
			var msgs messagesResp
			calls := []func() error{
				func() error {
					return run(ctx, []string{"chat", "spaces", "get", "--params", jsonArg(map[string]any{"name": spaceID})}, &space)
				},
				func() error {
					return run(ctx, []string{
						"chat", "users", "spaces", "getSpaceReadState",
						"--params", jsonArg(map[string]any{"name": "users/me/" + spaceID + "/spaceReadState"}),
					}, &rs)
				},
				func() error {
					return run(ctx, []string{
						"chat", "spaces", "messages", "list",
						"--params", jsonArg(map[string]any{"parent": spaceID, "orderBy": "createTime desc", "pageSize": 1}),
					}, &msgs)
				},
			}
			var innerWg sync.WaitGroup
			errs := make([]error, len(calls))
			for j, call := range calls {
				innerWg.Add(1)
				go func() {
					defer innerWg.Done()
					errs[j] = call()
				}()
			}
			innerWg.Wait()
			if err := firstNonNil(errs); err != nil {
				results[i] = result{err: err}
				return
			}
			var msg *chatMessage
			if len(msgs.Messages) > 0 {
				msg = &msgs.Messages[0]
			}
			results[i] = result{channel: normalizeChannel(spaceID, space, rs, msg)}
		}()
	}
	wg.Wait()

	channels := []ChatChannel{}
	errors := []string{}
	for i, r := range results {
		if r.err != nil {
			// A stale/404 space id: surface which one, don't drop silently.
			errors = append(errors, cfg.SpaceIDs[i])
			continue
		}
		channels = append(channels, r.channel)
	}
	if len(errors) > 0 {
		return ChatChannelsData{Channels: channels, Errors: errors}, nil
	}
	return ChatChannelsData{Channels: channels}, nil
}

func firstNonNil(errs []error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
