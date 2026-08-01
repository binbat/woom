use rand::Rng;

const SPLIT_SYMBOL_LENGTH: usize = 3;
const SPLIT_SYMBOL_SEPARATOR: char = '-';

pub fn gen_number_secret(n: usize) -> String {
    let mut rng = rand::rng();
    (0..n).map(|_| rng.random_range(b'0'..=b'9') as char).collect()
}

pub fn add_split_symbol(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + s.len() / SPLIT_SYMBOL_LENGTH);
    for (i, c) in s.chars().enumerate() {
        result.push(c);
        if (i + 1) % SPLIT_SYMBOL_LENGTH == 0 && i != s.len() - 1 {
            result.push(SPLIT_SYMBOL_SEPARATOR);
        }
    }
    result
}

// Kept for parity with the split-symbol helpers; only used by tests for now.
#[allow(dead_code)]
pub fn del_split_symbol(s: &str) -> String {
    s.replace(SPLIT_SYMBOL_SEPARATOR, "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_symbol() {
        let sets = [
            ("", ""),
            ("123", "123"),
            ("123456789", "123-456-789"),
            ("1234567899", "123-456-789-9"),
        ];

        for (k, v) in sets {
            assert_eq!(add_split_symbol(k), v);
        }
        for (k, v) in sets {
            assert_eq!(del_split_symbol(v), k);
        }
    }
}
