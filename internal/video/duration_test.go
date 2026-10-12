package video

import (
	"errors"
	"testing"
)

func TestNewDuration(t *testing.T) {
	tests := []struct {
		name    string
		seconds int64
		wantErr bool
	}{
		{name: "zero", seconds: 0},
		{name: "one and a half hours", seconds: 5400},
		{name: "longest accepted", seconds: maxSeconds},
		{name: "negative", seconds: -1, wantErr: true},
		{name: "too long", seconds: maxSeconds + 1, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, err := NewDuration(tt.seconds)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidDuration) {
					t.Fatalf("NewDuration(%d) error = %v, want ErrInvalidDuration", tt.seconds, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("NewDuration(%d) unexpected error: %v", tt.seconds, err)
			}
			if d.Seconds() != tt.seconds {
				t.Errorf("Seconds() = %d, want %d", d.Seconds(), tt.seconds)
			}
		})
	}
}

func TestParseProbeDuration(t *testing.T) {
	tests := []struct {
		input   string
		want    int64
		wantErr bool
	}{
		{input: "5400.123000", want: 5400},
		{input: "81.000000", want: 81},
		{input: "0.4", want: 0},
		{input: "0.5", want: 1},
		{input: "59.6", want: 60},
		{input: "  12.0\n", want: 12},
		{input: "0", want: 0},
		{input: "", wantErr: true},
		{input: "N/A", wantErr: true},
		{input: "NaN", wantErr: true},
		{input: "Inf", wantErr: true},
		{input: "-1.0", wantErr: true},
		{input: "1:30", wantErr: true},
		{input: "1e300", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			d, err := ParseProbeDuration(tt.input)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidDuration) {
					t.Fatalf("ParseProbeDuration(%q) error = %v, want ErrInvalidDuration", tt.input, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseProbeDuration(%q) unexpected error: %v", tt.input, err)
			}
			if d.Seconds() != tt.want {
				t.Errorf("ParseProbeDuration(%q) = %d seconds, want %d", tt.input, d.Seconds(), tt.want)
			}
		})
	}
}

func TestDurationString(t *testing.T) {
	tests := []struct {
		seconds int64
		want    string
	}{
		{seconds: 0, want: "0:00"},
		{seconds: 5, want: "0:05"},
		{seconds: 81, want: "1:21"},
		{seconds: 245, want: "4:05"},
		{seconds: 3599, want: "59:59"},
		{seconds: 3600, want: "1:00:00"},
		{seconds: 5400, want: "1:30:00"},
		{seconds: 36000, want: "10:00:00"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			d, err := NewDuration(tt.seconds)
			if err != nil {
				t.Fatalf("NewDuration(%d): %v", tt.seconds, err)
			}
			if got := d.String(); got != tt.want {
				t.Errorf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestZeroDurationIsValid(t *testing.T) {
	var d Duration
	if d.Seconds() != 0 || d.String() != "0:00" {
		t.Errorf("zero Duration = %d (%q), want 0 (\"0:00\")", d.Seconds(), d.String())
	}
}
