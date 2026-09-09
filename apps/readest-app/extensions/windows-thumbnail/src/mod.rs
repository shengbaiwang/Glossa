//! Windows Thumbnail Provider for Glossa
//!
//! This module provides Windows Explorer thumbnail support for eBook files.
//! Thumbnails are shown when Glossa or legacy Readest is the default application.
//!
//! Supported formats: EPUB, MOBI, AZW, AZW3, KF8, FB2, CBZ, CBR

#![allow(non_snake_case)]

mod app_identity;
mod com_provider;
mod extraction;

pub use extraction::*;
